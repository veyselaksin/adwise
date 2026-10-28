import type { Commit, Platform, Release } from "../types/releases.type.js";

const HEADER = /^Release (ios|android) (\S+)\s*\nReleased: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC/;
const COMMIT = /^commit (\w+)\nAuthor: (.+)\nDate: +(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC\n\n([\s\S]*)$/;
const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/;

/**
 * Parses one build log: a `Release <platform> <version>` header, a `Released:`
 * line, then `git log`-style commits with indented messages.
 */
export function parseBuildLog(text: string): Release {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const header = HEADER.exec(normalized);
  if (!header) throw new Error("Build log has no `Release <platform> <version>` header");
  const [, platform, version, released] = header as unknown as [string, Platform, string, string];

  const commits = normalized
    .slice(header[0].length)
    .split(/\n(?=commit \w+\n)/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(parseCommit);
  return { platform, version, released, date: released.slice(0, 10), commits };
}

function parseCommit(block: string): Commit {
  const match = COMMIT.exec(block);
  if (!match) throw new Error(`Unreadable commit block: ${block.slice(0, 40)}`);
  const [, hash, author, date, message] = match as unknown as [string, string, string, string, string];
  const [title = "", ...rest] = message.split("\n").map((line) => line.replace(/^ {4}/, ""));
  const conventional = CONVENTIONAL.exec(title.trim());
  return {
    hash,
    author: author.trim(),
    date,
    type: conventional?.[1] ?? null,
    scope: conventional?.[2] ?? null,
    title: conventional?.[3] ?? title.trim(),
    body: rest.join("\n").trim(),
  };
}
