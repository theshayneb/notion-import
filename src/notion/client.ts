import { requestUrl, type RequestUrlResponse } from "obsidian";
import { blockContent, summarizePage, type NotionBlock, type NotionDatabase, type NotionList, type NotionPage, type NotionPageSummary } from "./types";

const API_ROOT = "https://api.notion.com/v1";
const API_VERSION = "2022-06-28";
// Notion allows an average of three requests per second per integration.
const MIN_REQUEST_GAP_MS = 350;
const MAX_DEPTH = 12;

export class NotionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "NotionError";
  }
}

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

export class NotionClient {
  private nextRequestAt = 0;

  constructor(private readonly token: string) {}

  get hasToken(): boolean {
    return this.token.trim().length > 0;
  }

  async getPage(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>("GET", `/pages/${pageId}`);
  }

  async whoAmI(): Promise<string> {
    const me = await this.request<{ name?: string; bot?: { workspace_name?: string } }>("GET", "/users/me");
    return me.bot?.workspace_name ?? me.name ?? "Notion";
  }

  /** Searches pages shared with the integration. An empty query lists them all. */
  async searchPages(query: string, limit = Infinity): Promise<NotionPageSummary[]> {
    const pages: NotionPageSummary[] = [];
    let cursor: string | null = null;
    do {
      const body: Record<string, unknown> = {
        query,
        filter: { property: "object", value: "page" },
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;
      const list: NotionList<NotionPage> = await this.request("POST", "/search", body);
      for (const page of list.results) {
        if (page.object === "page" && !page.archived && !page.in_trash) pages.push(summarizePage(page));
      }
      cursor = list.has_more ? list.next_cursor : null;
    } while (cursor && pages.length < limit);
    return pages;
  }

  /** IDs and titles of the databases shared with the integration. */
  async searchDatabases(): Promise<NotionPageSummary[]> {
    const databases: NotionPageSummary[] = [];
    let cursor: string | null = null;
    do {
      const body: Record<string, unknown> = { filter: { property: "object", value: "database" }, page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const list: NotionList<NotionDatabase> = await this.request("POST", "/search", body);
      for (const database of list.results) {
        if (database.object !== "database" || database.archived || database.in_trash) continue;
        databases.push({
          id: database.id,
          title: (database.title ?? []).map(part => part.plain_text).join("") || "Untitled",
          url: database.url,
        });
      }
      cursor = list.has_more ? list.next_cursor : null;
    } while (cursor);
    return databases;
  }

  /** Every row of a database. Unlike search, this is guaranteed to be complete. */
  async queryDatabase(databaseId: string): Promise<NotionPageSummary[]> {
    const pages: NotionPageSummary[] = [];
    let cursor: string | null = null;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const list: NotionList<NotionPage> = await this.request("POST", `/databases/${databaseId}/query`, body);
      for (const page of list.results) {
        if (page.object === "page" && !page.archived && !page.in_trash) pages.push(summarizePage(page));
      }
      cursor = list.has_more ? list.next_cursor : null;
    } while (cursor);
    return pages;
  }

  /**
   * Every page the integration can read: what search returns, plus every row of every
   * shared database, because search alone is not guaranteed to list everything.
   */
  async listAllPages(): Promise<{ pages: NotionPageSummary[]; fromSearch: number; fromDatabases: number; failedDatabases: string[] }> {
    const byId = new Map<string, NotionPageSummary>();
    for (const page of await this.searchPages("")) byId.set(page.id, page);
    const fromSearch = byId.size;
    const failedDatabases: string[] = [];
    for (const database of await this.searchDatabases()) {
      try {
        for (const page of await this.queryDatabase(database.id)) if (!byId.has(page.id)) byId.set(page.id, page);
      } catch {
        failedDatabases.push(database.title);
      }
    }
    return { pages: [...byId.values()], fromSearch, fromDatabases: byId.size - fromSearch, failedDatabases };
  }

  async getChildren(blockId: string): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = [];
    let cursor: string | null = null;
    do {
      const query = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
      const list: NotionList<NotionBlock> = await this.request("GET", `/blocks/${blockId}/children${query}`);
      blocks.push(...list.results);
      cursor = list.has_more ? list.next_cursor : null;
    } while (cursor);
    return blocks;
  }

  /** Fetches a page's blocks with every nested child, except sub-pages and databases. */
  async getBlockTree(blockId: string, depth = 0): Promise<NotionBlock[]> {
    const blocks = await this.getChildren(blockId);
    for (const block of blocks) {
      if (depth >= MAX_DEPTH) break;
      if (block.type === "child_page" || block.type === "child_database") continue;
      // A synced copy holds no children of its own; they live on the original block.
      const syncedFrom = block.type === "synced_block" ? blockContent(block).synced_from?.block_id : undefined;
      if (syncedFrom) {
        try {
          block.children = await this.getBlockTree(syncedFrom, depth + 1);
        } catch {
          block.children = [];
        }
      } else if (block.has_children) {
        block.children = await this.getBlockTree(block.id, depth + 1);
      }
    }
    return blocks;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.hasToken) throw new NotionError("Add your Notion integration token in the Notion Import settings.", 0);
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      let response: RequestUrlResponse;
      try {
        response = await requestUrl({
          url: API_ROOT + path,
          method,
          headers: {
            Authorization: `Bearer ${this.token.trim()}`,
            "Notion-Version": API_VERSION,
          },
          contentType: "application/json",
          body: body === undefined ? undefined : JSON.stringify(body),
          throw: false,
        });
      } catch (error) {
        if (attempt < 2) {
          await wait(1000 * (attempt + 1));
          continue;
        }
        throw new NotionError(`Could not reach Notion: ${error instanceof Error ? error.message : String(error)}`, 0);
      }

      if (response.status === 429 && attempt < 5) {
        const retryAfter = Number(response.headers["retry-after"] ?? response.headers["Retry-After"]);
        await wait((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1) * 1000);
        continue;
      }
      if (response.status >= 500 && attempt < 2) {
        await wait(1000 * (attempt + 1));
        continue;
      }
      if (response.status >= 400) throw new NotionError(describeError(response), response.status);
      return JSON.parse(response.text) as T;
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = start + MIN_REQUEST_GAP_MS;
    if (start > now) await wait(start - now);
  }
}

function describeError(response: RequestUrlResponse): string {
  let message = "";
  try {
    message = (JSON.parse(response.text) as { message?: string }).message ?? "";
  } catch {
    // Not JSON; fall through to the status-based message.
  }
  if (response.status === 401) return "Notion rejected the token. Check it in the Notion Import settings.";
  if (response.status === 404) {
    return "Notion page not found. Share it with your integration (page menu → Connections) and check the link.";
  }
  return `Notion error ${response.status}${message ? `: ${message}` : ""}`;
}
