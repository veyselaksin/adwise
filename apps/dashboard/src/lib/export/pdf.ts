import "server-only";
import PDFDocument from "pdfkit";
import { formatCell } from "./formats";
import type { ExportReport, ExportTable } from "@typings/export";

const MARGIN = 36;
const FONT = "Helvetica";
const BOLD = "Helvetica-Bold";
const SIZE = 7;
const ROW_HEIGHT = 12;
const PAD = 4;
const COLORS = { text: "#111111", muted: "#666666", rule: "#DDDDDD", headerFill: "#F2F2F2", notFinal: "#9A6700" };

type Doc = InstanceType<typeof PDFDocument>;

/** A landscape A4 report: filters and notes, then every table, paginated with repeated headers. */
export function toPdf(report: ExportReport): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: MARGIN,
    bufferPages: true,
    info: { Title: report.title, Creator: "ADWISE" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });

  doc.fillColor(COLORS.text).font(BOLD).fontSize(16).text(report.title);
  doc
    .font(FONT)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`Generated ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC`);
  doc.moveDown(0.6);
  for (const f of report.filters) {
    doc.font(BOLD).fontSize(9).fillColor(COLORS.text).text(`${f.label}: `, { continued: true });
    doc.font(FONT).text(winAnsi(f.value));
  }
  doc.moveDown(0.4);
  doc.font(FONT).fontSize(8).fillColor(COLORS.muted);
  for (const note of report.notes) doc.text(winAnsi(note));

  for (const table of report.tables) drawTable(doc, table);

  // Page numbers, once every page exists.
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    // The footer sits in the bottom margin; without this pdfkit treats it as overflow and adds a page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN + 10;
    doc.font(FONT).fontSize(7).fillColor(COLORS.muted);
    doc.text(`${report.title} · page ${i + 1} of ${count}`, MARGIN, y, {
      width: doc.page.width - MARGIN * 2,
      align: "right",
      lineBreak: false,
    });
  }
  doc.end();
  return done;
}

function drawTable(doc: Doc, table: ExportTable) {
  const left = MARGIN;
  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 6;

  // Title, description and header must fit with at least a few rows.
  if (doc.y + 70 > bottom()) doc.addPage();
  else doc.moveDown(1.2);
  doc.font(BOLD).fontSize(11).fillColor(COLORS.text).text(winAnsi(table.title), left);
  if (table.description) doc.font(FONT).fontSize(8).fillColor(COLORS.muted).text(winAnsi(table.description), left);
  doc.moveDown(0.3);

  const texts = table.rows.map((row) =>
    table.columns.map((c) => winAnsi(formatCell(table, row, c.key)) + (row.notFinal?.includes(c.key) ? "*" : "")),
  );
  const widths = columnWidths(doc, table, texts, width);
  const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const align = (i: number) => (table.columns[i]!.unit === "text" ? "left" : "right");
  const headerHeight = ROW_HEIGHT * 2;

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, width, headerHeight).fill(COLORS.headerFill);
    doc.font(BOLD).fontSize(SIZE).fillColor(COLORS.text);
    table.columns.forEach((c, i) =>
      doc.text(winAnsi(c.label), xs[i]! + PAD, y + 3, { width: widths[i]! - PAD * 2, height: headerHeight - 3, align: align(i) }),
    );
    doc.y = y + headerHeight;
  };

  drawHeader();
  let anyNotFinal = false;
  texts.forEach((cells, r) => {
    if (doc.y + ROW_HEIGHT > bottom()) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.moveTo(left, y + ROW_HEIGHT).lineTo(left + width, y + ROW_HEIGHT).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
    cells.forEach((text, i) => {
      const notFinal = table.rows[r]!.notFinal?.includes(table.columns[i]!.key);
      anyNotFinal ||= !!notFinal;
      doc.font(FONT).fontSize(SIZE).fillColor(notFinal ? COLORS.notFinal : COLORS.text);
      doc.text(truncate(doc, text, widths[i]! - PAD * 2), xs[i]! + PAD, y + 3, {
        width: widths[i]! - PAD * 2,
        align: align(i),
        lineBreak: false,
      });
    });
    doc.y = y + ROW_HEIGHT;
  });

  if (table.rows.length === 0) {
    doc.font(FONT).fontSize(SIZE).fillColor(COLORS.muted).text("No data for these filters.", left, doc.y + 4);
  }
  if (anyNotFinal) {
    doc.font(FONT).fontSize(7).fillColor(COLORS.notFinal);
    doc.text("* Not final: includes days that are still too recent (e.g. CAC for days less than 4 days old).", left, doc.y + 4);
  }
  doc.x = left;
}

/**
 * Numbers get the width they need; when everything fits, the spare width is
 * spread over all columns, otherwise text columns shrink (and truncate).
 */
function columnWidths(doc: Doc, table: ExportTable, texts: string[][], total: number): number[] {
  const natural = table.columns.map((c, i) => {
    doc.font(FONT).fontSize(SIZE);
    const content = Math.max(0, ...texts.map((row) => doc.widthOfString(row[i]!)));
    doc.font(BOLD);
    return Math.ceil(Math.max(content, headerWidth(doc, winAnsi(c.label)))) + PAD * 2;
  });
  doc.font(FONT);
  const sum = natural.reduce((a, b) => a + b, 0);
  if (sum <= total) return natural.map((w) => w + ((total - sum) * w) / sum);

  const isText = table.columns.map((c) => c.unit === "text");
  const fixed = natural.reduce((acc, w, i) => acc + (isText[i] ? 0 : w), 0);
  const textNatural = sum - fixed;
  return natural.map((w, i) => (isText[i] ? Math.max(40, ((total - fixed) * w) / textNatural) : w));
}

/** Narrowest width that shows `label` in at most two lines (the header height). */
function headerWidth(doc: Doc, label: string): number {
  const words = label.split(" ");
  let best = doc.widthOfString(label);
  for (let i = 1; i < words.length; i++) {
    const first = doc.widthOfString(words.slice(0, i).join(" "));
    const second = doc.widthOfString(words.slice(i).join(" "));
    best = Math.min(best, Math.max(first, second));
  }
  return best;
}

function truncate(doc: Doc, text: string, width: number): string {
  // Small tolerance: widths are sums of floats.
  if (doc.widthOfString(text) <= width + 0.5) return text;
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** The built-in PDF fonts only cover WinAnsi; swap the few symbols outside it. */
function winAnsi(text: string): string {
  return text.replace(/ → /g, " to ").replace(/→/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=");
}
