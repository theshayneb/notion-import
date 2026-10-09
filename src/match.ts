import { TFile, type App } from "obsidian";
import type { NotionClient } from "./notion/client";
import type { NotionPageSummary } from "./notion/types";
import type { NotionImportSettings } from "./settings";
import { FuzzyIndex, fuzzyKey } from "./fuzzy";
import { extractPageId, normalizeTitle } from "./text";

export type MatchSource = "property" | "title" | "fuzzy" | "manual";

export interface NotionCandidate {
  pageId: string;
  /** Empty until the page is fetched when the match came from the link property. */
  title: string;
  url: string;
  via: MatchSource;
  /** Title similarity from 0 to 1, for title and fuzzy matches. */
  score?: number;
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

export interface TitleHit {
  page: NotionPageSummary;
  /** 1 for an exact title match, lower for a similar one. */
  score: number;
}

/** Every page shared with the integration, indexed for exact and fuzzy title lookups. */
export class TitleIndex {
  private readonly exact = new Map<string, NotionPageSummary[]>();
  private readonly fuzzy = new FuzzyIndex<NotionPageSummary>();
  readonly size: number;

  private constructor(pages: NotionPageSummary[], private readonly ignoreCase: boolean) {
    this.size = pages.length;
    for (const page of pages) {
      const key = normalizeTitle(page.title, ignoreCase);
      if (key) this.exact.set(key, [...(this.exact.get(key) ?? []), page]);
      this.fuzzy.add(fuzzyKey(page.title), page);
    }
  }

  static async build(client: NotionClient, ignoreCase: boolean): Promise<TitleIndex> {
    return new TitleIndex(await client.searchPages(""), ignoreCase);
  }

  /**
   * Exact matches win outright. Without one, and when `fuzzyThreshold` is set, the
   * closest similar titles are returned, best first.
   */
  lookup(titles: string[], fuzzyThreshold: number | null): TitleHit[] {
    const found = new Map<string, TitleHit>();
    for (const title of titles) {
      for (const page of this.exact.get(normalizeTitle(title, this.ignoreCase)) ?? []) found.set(page.id, { page, score: 1 });
    }
    if (found.size || fuzzyThreshold == null) return [...found.values()];
    for (const title of titles) {
      for (const { item, score } of this.fuzzy.search(fuzzyKey(title), fuzzyThreshold, MAX_FUZZY_CANDIDATES)) {
        if ((found.get(item.id)?.score ?? 0) < score) found.set(item.id, { page: item, score });
      }
    }
    return [...found.values()].sort((a, b) => b.score - a.score).slice(0, MAX_FUZZY_CANDIDATES);
  }
}

const MAX_FUZZY_CANDIDATES = 3;

function titleCandidates(app: App, file: TFile, settings: NotionImportSettings, index: TitleIndex): NotionCandidate[] {
  const threshold = settings.fuzzyMatching ? settings.fuzzyThreshold / 100 : null;
  return index.lookup(titlesFor(app, file, settings), threshold).map(({ page, score }) => ({
    pageId: page.id,
    title: page.title,
    url: page.url,
    via: score >= 1 ? "title" : "fuzzy",
    score,
  }));
}

/** True when no folders are listed, or the file is inside one of them (subfolders included). */
function isInScannedFolders(file: TFile, settings: NotionImportSettings): boolean {
  const folders = settings.includedFolders
    .split("\n")
    .map(folder => folder.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return !folders.length || folders.some(folder => file.path.startsWith(`${folder}/`));
}

export async function scanVault(
  app: App,
  settings: NotionImportSettings,
  getIndex: () => Promise<TitleIndex>,
): Promise<{ matches: NoteMatch[]; pageCount: number | null }> {
  const index = settings.matchByTitle ? await getIndex() : null;
  const matches: NoteMatch[] = [];
  const files = app.vault.getMarkdownFiles();
  for (const [i, file] of files.entries()) {
    // Let Obsidian repaint now and then; fuzzy matching a large vault takes a moment.
    if (i % 250 === 249) await new Promise(resolve => window.setTimeout(resolve, 0));
    if (!isInScannedFolders(file, settings)) continue;
    const linked = propertyCandidate(app, file, settings);
    if (linked) {
      matches.push({ file, candidates: [linked] });
      continue;
    }
    const byTitle = index ? titleCandidates(app, file, settings, index) : [];
    if (byTitle.length) matches.push({ file, candidates: byTitle });
  }
  matches.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
  return { matches, pageCount: index ? index.size : null };
}

/** Candidates for one note: its link property, else Notion pages with the same or a similar title. */
export async function matchFile(
  app: App,
  settings: NotionImportSettings,
  file: TFile,
  getIndex: () => Promise<TitleIndex>,
): Promise<NotionCandidate[]> {
  const linked = propertyCandidate(app, file, settings);
  if (linked) return [linked];
  if (!settings.matchByTitle) return [];
  return titleCandidates(app, file, settings, await getIndex());
}

export function isMarkdownFile(file: unknown): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
