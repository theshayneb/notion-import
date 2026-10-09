// Converts a Notion block tree into Markdown "units": one per top-level block,
// which is the granularity the compare view lets you pick from.
// Only type imports here, so the module also runs under plain Node for tests.
import type { BlockContent, NotionBlock, RichText } from "./types";

export type CalloutStyle = "plain" | "callout";

export interface ConvertOptions {
  calloutStyle: CalloutStyle;
}

export interface AssetRef {
  /** The exact Markdown snippet in the unit that the downloaded file replaces. */
  snippet: string;
  url: string;
  fileName: string;
  /** Embed with `!` (images, PDFs, audio, video) rather than link. */
  embed: boolean;
}

export interface ImportUnit {
  id: string;
  type: string;
  /** 1–3 for Notion headings, otherwise null. */
  headingLevel: number | null;
  markdown: string;
  /** All visible text, for checking whether the note already contains it. */
  plain: string;
  /** Notion-hosted files; their URLs expire after an hour, so they are downloaded on import. */
  assets: AssetRef[];
  /** Set for list items, so consecutive ones are joined without a blank line. */
  listKind: "bullet" | "number" | "todo" | null;
}

const LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do", "toggle"]);
const content = (block: NotionBlock) => (block[block.type] ?? {}) as BlockContent;

export function blocksToUnits(blocks: NotionBlock[], options: ConvertOptions): ImportUnit[] {
  const units: ImportUnit[] = [];
  for (const block of blocks) {
    const assets: AssetRef[] = [];
    const markdown = renderBlock(block, options, assets).trim();
    if (!markdown) continue;
    units.push({
      id: block.id,
      type: block.type,
      headingLevel: headingLevel(block),
      markdown,
      plain: plainText(block),
      assets,
      listKind: listKind(block),
    });
  }
  return units;
}

/** Joins units in order, keeping consecutive list items in one list. */
export function joinUnits(units: { markdown: string; listKind: ImportUnit["listKind"] }[]): string {
  let out = "";
  units.forEach((unit, index) => {
    if (index > 0) out += unit.listKind && units[index - 1].listKind ? "\n" : "\n\n";
    out += unit.markdown;
  });
  return out;
}

/** Demotes the leading heading of a unit by `offset` levels (max level 6). */
export function shiftHeading(markdown: string, offset: number): string {
  if (offset <= 0) return markdown;
  return markdown.replace(/^(#{1,6}) /, (_, hashes: string) => "#".repeat(Math.min(6, hashes.length + offset)) + " ");
}

/** For a heading unit, the indices of the heading and everything until the next heading of the same or higher level. */
export function sectionRange(units: ImportUnit[], index: number): number[] {
  const level = units[index]?.headingLevel;
  if (level == null) return [index];
  const range = [index];
  for (let i = index + 1; i < units.length; i++) {
    const other = units[i].headingLevel;
    if (other != null && other <= level) break;
    range.push(i);
  }
  return range;
}

function headingLevel(block: NotionBlock): number | null {
  const match = /^heading_([123])$/.exec(block.type);
  return match ? Number(match[1]) : null;
}

function listKind(block: NotionBlock): ImportUnit["listKind"] {
  switch (block.type) {
    case "bulleted_list_item":
    case "toggle":
      return "bullet";
    case "numbered_list_item":
      return "number";
    case "to_do":
      return "todo";
    default:
      return null;
  }
}

export function richTextToMarkdown(parts: RichText[] | undefined): string {
  if (!parts) return "";
  return parts.map(renderRichText).join("");
}

function renderRichText(part: RichText): string {
  if (part.type === "equation" && part.equation) return `$${part.equation.expression}$`;
  const raw = part.plain_text;
  if (!raw) return "";
  const a = part.annotations;
  // Markers must hug the text, so keep surrounding whitespace outside them.
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw) ?? ["", "", raw, ""];
  if (!core) return raw;
  let text = a?.code ? codeSpan(core) : core;
  if (a?.bold) text = `**${text}**`;
  if (a?.italic) text = `*${text}*`;
  if (a?.strikethrough) text = `~~${text}~~`;
  if (part.href) text = `[${text}](${linkTarget(part.href)})`;
  return lead + text + trail;
}

function codeSpan(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function linkTarget(href: string): string {
  // Notion mentions of other pages come through as site-relative paths.
  const url = href.startsWith("/") ? `https://www.notion.so${href}` : href;
  return /[\s()]/.test(url) ? `<${url}>` : url;
}

function indent(markdown: string): string {
  return markdown
    .split("\n")
    .map(line => (line ? `\t${line}` : line))
    .join("\n");
}

function quote(markdown: string): string {
  return markdown
    .split("\n")
    .map(line => (line ? `> ${line}` : ">"))
    .join("\n");
}

function renderChildren(block: NotionBlock, options: ConvertOptions, assets: AssetRef[]): string {
  const children = block.children ?? [];
  let out = "";
  let previous: NotionBlock | null = null;
  for (const child of children) {
    const markdown = renderBlock(child, options, assets).trim();
    if (!markdown) continue;
    if (previous) out += LIST_TYPES.has(child.type) && LIST_TYPES.has(previous.type) ? "\n" : "\n\n";
    out += markdown;
    previous = child;
  }
  return out;
}

function withChildren(head: string, block: NotionBlock, options: ConvertOptions, assets: AssetRef[], nest: boolean): string {
  const children = renderChildren(block, options, assets);
  if (!children) return head;
  if (!head) return children;
  // Tab-indenting under a paragraph would turn the children into a code block, so only list items nest.
  return nest ? `${head}\n${indent(children)}` : `${head}\n\n${children}`;
}

function renderBlock(block: NotionBlock, options: ConvertOptions, assets: AssetRef[]): string {
  const c = content(block);
  const text = richTextToMarkdown(c.rich_text);
  switch (block.type) {
    case "paragraph":
      return withChildren(text, block, options, assets, false);
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = Number(block.type.slice(-1));
      return withChildren(`${"#".repeat(level)} ${text}`, block, options, assets, false);
    }
    case "bulleted_list_item":
    case "toggle":
      return withChildren(`- ${text}`, block, options, assets, true);
    case "numbered_list_item":
      return withChildren(`1. ${text}`, block, options, assets, true);
    case "to_do":
      return withChildren(`- [${c.checked ? "x" : " "}] ${text}`, block, options, assets, true);
    case "quote":
      return quote(withChildren(text, block, options, assets, false));
    case "callout": {
      const body = withChildren(text, block, options, assets, false);
      if (options.calloutStyle === "plain") return body;
      const icon = c.icon?.type === "emoji" && c.icon.emoji ? ` ${c.icon.emoji}` : "";
      return `> [!note]${icon}\n${quote(body)}`;
    }
    case "code": {
      const code = (c.rich_text ?? []).map(part => part.plain_text).join("");
      const fence = code.includes("```") ? "````" : "```";
      const language = c.language && c.language !== "plain text" ? c.language.replace(/\s+/g, "-") : "";
      const caption = richTextToMarkdown(c.caption);
      return `${fence}${language}\n${code}\n${fence}${caption ? `\n\n${caption}` : ""}`;
    }
    case "equation":
      return `$$\n${c.expression ?? ""}\n$$`;
    case "divider":
      return "---";
    case "image":
    case "pdf":
    case "video":
    case "audio":
    case "file":
      return renderFile(block, c, assets);
    case "bookmark":
    case "embed":
    case "link_preview": {
      if (!c.url) return "";
      const caption = richTextToMarkdown(c.caption);
      return `[${caption || c.url}](${linkTarget(c.url)})`;
    }
    case "table":
      return renderTable(block);
    case "column_list":
    case "column":
    case "synced_block":
      return renderChildren(block, options, assets);
    case "child_page":
      return `[${c.title || "Untitled"}](${notionUrl(block.id)})`;
    case "child_database":
      return `*Notion database “${c.title || "Untitled"}” (not imported)*`;
    case "link_to_page": {
      const target = c.page_id ?? c.database_id;
      return target ? `[Linked Notion page](${notionUrl(target)})` : "";
    }
    default:
      // table_of_contents, breadcrumb, template, unsupported and anything newer.
      return text ? withChildren(text, block, options, assets, false) : renderChildren(block, options, assets);
  }
}

function renderFile(block: NotionBlock, c: BlockContent, assets: AssetRef[]): string {
  const url = c.type === "external" ? c.external?.url : c.file?.url;
  if (!url) return "";
  const caption = richTextToMarkdown(c.caption);
  const fileName = c.name || fileNameFromUrl(url, block.type);
  const embed = block.type !== "file";
  const label = caption || (block.type === "image" ? "" : fileName);
  const snippet = `${embed && block.type === "image" ? "!" : ""}[${label}](${linkTarget(url)})`;
  if (c.type === "file") assets.push({ snippet, url, fileName, embed });
  return snippet;
}

function fileNameFromUrl(url: string, kind: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // Fall back to a generic name below.
  }
  return kind === "image" ? "notion-image.png" : `notion-${kind}`;
}

function renderTable(block: NotionBlock): string {
  const rows = (block.children ?? [])
    .filter(row => row.type === "table_row")
    .map(row => (content(row).cells ?? []).map(cell => richTextToMarkdown(cell).replace(/\|/g, "\\|").replace(/\n/g, "<br>")));
  if (!rows.length) return "";
  const width = Math.max(content(block).table_width ?? 0, ...rows.map(row => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "");
  const line = (row: string[]) => `| ${pad(row).join(" | ")} |`;
  // Markdown tables need a header row; without one in Notion, use an empty header.
  const header = content(block).has_column_header ? rows.shift() ?? [] : [];
  return [line(header), `|${" --- |".repeat(width)}`, ...rows.map(line)].join("\n");
}

function notionUrl(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

function plainText(block: NotionBlock): string {
  const c = content(block);
  const own = [
    ...(c.rich_text ?? []),
    ...(c.caption ?? []),
    ...(c.cells ?? []).flat(),
  ].map(part => part.plain_text);
  if (c.title) own.push(c.title);
  if (c.expression) own.push(c.expression);
  for (const child of block.children ?? []) own.push(plainText(child));
  return own.filter(Boolean).join(" ");
}
