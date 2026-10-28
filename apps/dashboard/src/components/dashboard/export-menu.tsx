"use client";

import { DownloadIcon, FileJsonIcon, FileSpreadsheetIcon, FileTextIcon, HashIcon, SheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FORMATS = [
  { format: "pdf", label: "PDF report", hint: "Print-ready tables", Icon: FileTextIcon },
  { format: "xlsx", label: "Excel workbook", hint: "One sheet per table", Icon: FileSpreadsheetIcon },
  { format: "csv", label: "CSV", hint: "Ads, with ad set and campaign", Icon: SheetIcon },
  { format: "json", label: "JSON", hint: "Raw numbers for scripts", Icon: FileJsonIcon },
  { format: "md", label: "Markdown", hint: "Tables for docs and chat", Icon: HashIcon },
] as const;

type Props = {
  /** The overview's query string, so the file matches the filters on screen. */
  search: string;
  /** Limit the file to these report tables (a card's own export); all when omitted. */
  tables?: string[];
  label?: string;
};

/** Downloads the current view, or one card of it, as PDF, Excel, CSV, JSON or Markdown. */
export function ExportMenu({ search, tables, label = "Export this view" }: Props) {
  const href = (format: string) => {
    const params = new URLSearchParams(search);
    params.set("format", format);
    if (tables) params.set("tables", tables.join(","));
    return `/export?${params}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <DownloadIcon /> Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {FORMATS.map(({ format, label, hint, Icon }) => (
            <DropdownMenuItem key={format} render={<a href={href(format)} download />}>
              <Icon />
              <div className="flex flex-col">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
