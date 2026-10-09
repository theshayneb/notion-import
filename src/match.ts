import { TFile, type App } from "obsidian";
import type { NotionClient } from "./notion/client";
import type { NotionPageSummary } from "./notion/types";
import type { NotionImportSettings } from "./settings";
import { extractPageId, normalizeTitle } from "./text";

export type MatchSource = "property" | "title" | "manual";

export interface NotionCandidate {
  pageId: string;
  /** Empty until the page is fetched when the match came from the link property. */
  title: string;
  url: string;
  via: MatchSource;
}

export interface NoteMatch {
  file: TFile;
  candidates: NotionCandidate[];
}

/** Reads the link property, whatever its capitalisation, as a string (first item of a list). */
export function readLinkProperty(app: App, file: TFile, propertyName: string): string | null {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return null;
  const wanted = propertyName.toLowerCase();
  const key = Object.keys(frontmatter).find(name => name.toLowerCase() === wanted);
  if (!key) return null;
  const value: unknown = frontmatter[key];
  const first = Array.isArray(value) ? value.find(item => typeof item === "string") : value;
  return typeof first === "string" && first.trim() ? first : null;
}

export function propertyCandidate(app: App, file: TFile, settings: NotionImportSettings): NotionCandidate | null {
  const raw = readLinkProperty(app, file, settings.propertyName);
  const pageId = raw ? extractPageId(raw) : null;
  if (!pageId) return null;
  return { pageId, title: "", url: raw?.startsWith("http") ? raw : `https://www.notion.so/${pageId.replace(/-/g, "")}`, via: "property" };
}

function titlesFor(app: App, file: TFile, settings: NotionImportSettings): string[] {
  const titles = [file.basename];
  if (settings.matchAliases) {
    const aliases: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.aliases;
    const list = Array.isArray(aliases) ? aliases : typeof aliases === "string" ? [aliases] : [];
    for (const alias of list) if (typeof alias === "string" && alias.trim()) titles.push(alias);
  }
  return titles;
}

/** Every page shared with the integration, keyed by normalised title. */
export class TitleIndex {
  private constructor(private readonly byTitle: Map<string, NotionPageSummary[]>, private readonly ignoreCase: boolean) {}

  static async build(client: NotionClient, ignoreCase: boolean): Promise<TitleIndex> {
    const map = new Map<string, NotionPageSummary[]>();
    for (const page of await client.searchPages("")) {
      const key = normalizeTitle(page.title, ignoreCase);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), page]);
    }
    return new TitleIndex(map, ignoreCase);
  }

  get size(): number {
    let count = 0;
    for (const pages of this.byTitle.values()) count += pages.length;
    return count;
  }

  lookup(titles: string[]): NotionPageSummary[] {
    const seen = new Set<string>();
    const found: NotionPageSummary[] = [];
    for (const title of titles) {
      for (const page of this.byTitle.get(normalizeTitle(title, this.ignoreCase)) ?? []) {
        if (!seen.has(page.id)) {
          seen.add(page.id);
          found.push(page);
        }
      }
    }
    return found;
  }
}

function isExcluded(file: TFile, settings: NotionImportSettings): boolean {
  return settings.excludedFolders
    .split("\n")
    .map(folder => folder.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .some(folder => file.path === folder || file.path.startsWith(`${folder}/`));
}

export async function scanVault(app: App, client: NotionClient, settings: NotionImportSettings): Promise<{ matches: NoteMatch[]; pageCount: number | null }> {
  const index = settings.matchByTitle ? await TitleIndex.build(client, settings.ignoreCase) : null;
  const matches: NoteMatch[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (isExcluded(file, settings)) continue;
    const linked = propertyCandidate(app, file, settings);
    if (linked) {
      matches.push({ file, candidates: [linked] });
      continue;
    }
    const byTitle = index?.lookup(titlesFor(app, file, settings)) ?? [];
    if (byTitle.length) {
      matches.push({ file, candidates: byTitle.map(page => ({ pageId: page.id, title: page.title, url: page.url, via: "title" })) });
    }
  }
  matches.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
  return { matches, pageCount: index ? index.size : null };
}

/** Candidates for one note: its link property, else Notion pages whose title matches. */
export async function matchFile(app: App, client: NotionClient, settings: NotionImportSettings, file: TFile): Promise<NotionCandidate[]> {
  const linked = propertyCandidate(app, file, settings);
  if (linked) return [linked];
  if (!settings.matchByTitle) return [];
  const titles = titlesFor(app, file, settings).map(title => normalizeTitle(title, settings.ignoreCase));
  const found: NotionCandidate[] = [];
  for (const title of new Set(titles)) {
    for (const page of await client.searchPages(title, 100)) {
      if (titles.includes(normalizeTitle(page.title, settings.ignoreCase)) && !found.some(c => c.pageId === page.id)) {
        found.push({ pageId: page.id, title: page.title, url: page.url, via: "title" });
      }
    }
  }
  return found;
}

export function isMarkdownFile(file: unknown): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
