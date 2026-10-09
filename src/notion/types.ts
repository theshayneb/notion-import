// The small slice of the Notion API (version 2022-06-28) this plugin reads.

export interface RichText {
  type: "text" | "mention" | "equation";
  plain_text: string;
  href: string | null;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  equation?: { expression: string };
}

export interface NotionFileObject {
  type?: "file" | "external" | "file_upload";
  file?: { url: string; expiry_time?: string };
  external?: { url: string };
  name?: string;
  caption?: RichText[];
}

/** The type-specific payload of a block, i.e. `block[block.type]`. */
export interface BlockContent extends NotionFileObject {
  rich_text?: RichText[];
  checked?: boolean;
  language?: string;
  url?: string;
  title?: string;
  expression?: string;
  is_toggleable?: boolean;
  table_width?: number;
  has_column_header?: boolean;
  cells?: RichText[][];
  synced_from?: { block_id: string } | null;
  icon?: { type: string; emoji?: string } | null;
  page_id?: string;
  database_id?: string;
  block_id?: string;
}

export interface NotionBlock {
  object: "block";
  id: string;
  type: string;
  has_children: boolean;
  [type: string]: unknown;
  /** Filled in by the client when it walks the tree; not part of the API response. */
  children?: NotionBlock[];
}

export interface NotionPage {
  object: "page";
  id: string;
  url: string;
  archived?: boolean;
  in_trash?: boolean;
  properties: Record<string, { type: string; title?: RichText[] }>;
}

export interface NotionList<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotionPageSummary {
  id: string;
  title: string;
  url: string;
}

export function blockContent(block: NotionBlock): BlockContent {
  return block[block.type] ?? {};
}

export function pageTitle(page: NotionPage): string {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") return (property.title ?? []).map(part => part.plain_text).join("");
  }
  return "";
}

export function summarizePage(page: NotionPage): NotionPageSummary {
  return { id: page.id, title: pageTitle(page) || "Untitled", url: page.url };
}
