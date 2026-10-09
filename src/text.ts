// Pure text helpers (no Obsidian imports) so they can be unit-tested under Node.

const UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;

/**
 * Pulls a Notion page ID out of a page URL or a bare ID, e.g.
 * https://www.notion.so/team/My-Page-0123456789abcdef0123456789abcdef?pvs=4.
 * A `p=` query parameter (a page opened as a peek over a database) wins over the path.
 */
export function extractPageId(value: string): string | null {
  const input = value.trim().replace(/^\[.*?\]\((.*)\)$/, "$1");
  if (!input) return null;
  let candidates: string[];
  try {
    const url = new URL(input);
    const peek = url.searchParams.get("p");
    candidates = peek ? [peek] : [url.pathname];
  } catch {
    candidates = [input];
  }
  for (const candidate of candidates) {
    const matches = candidate.match(UUID);
    if (matches?.length) return toUuid(matches[matches.length - 1]);
  }
  return null;
}

function toUuid(id: string): string {
  const hex = id.replace(/-/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Normalises a title so Obsidian file names (which can't hold some characters) match Notion titles. */
export function normalizeTitle(title: string, ignoreCase: boolean): string {
  const cleaned = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ignoreCase ? cleaned.toLowerCase() : cleaned;
}

/** Reduces text to lowercase words so Markdown formatting differences don't affect "already in note" checks. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/[*_~`#>|[\]()!=\-:.,;"'“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface HeadingInfo {
  level: number;
  text: string;
  line: number;
}

/** ATX headings outside front matter and fenced code blocks. */
export function findHeadings(markdown: string): HeadingInfo[] {
  const lines = markdown.split("\n");
  const headings: HeadingInfo[] = [];
  let fence: string | null = null;
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) start = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1].startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) headings.push({ level: heading[1].length, text: heading[2], line: i });
  }
  return headings;
}

/** Appends a block to the end of a note, separated by a blank line. */
export function appendBlock(markdown: string, block: string): string {
  const trimmed = markdown.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

/**
 * Inserts a block at the end of the section under a heading, i.e. just before the
 * next heading of the same or higher level. The heading is located by its text and
 * how many earlier headings share that text, since line numbers may have shifted.
 */
export function insertUnderHeading(markdown: string, target: { text: string; occurrence: number }, block: string): string {
  const headings = findHeadings(markdown);
  const sameText = headings.filter(heading => heading.text === target.text);
  const heading = sameText[target.occurrence] ?? sameText[0];
  if (!heading) return appendBlock(markdown, block);

  const lines = markdown.split("\n");
  const next = headings.find(other => other.line > heading.line && other.level <= heading.level);
  let end = next ? next.line : lines.length;
  while (end - 1 > heading.line && lines[end - 1].trim() === "") end--;

  const before = lines.slice(0, end);
  const after = lines.slice(end);
  while (after.length && after[0].trim() === "") after.shift();
  const pieces = [before.join("\n"), "", block];
  if (after.length) pieces.push("", after.join("\n"));
  else pieces.push("");
  return pieces.join("\n");
}
