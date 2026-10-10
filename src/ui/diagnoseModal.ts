import { Modal, type TFile } from "obsidian";
import type NotionImportPlugin from "../main";
import { isInScannedFolders, propertyCandidate, readLinkProperty, titlesFor, type TitleIndex } from "../match";
import { fuzzyKey, titleSimilarity } from "../fuzzy";
import { summarizePage } from "../notion/types";
import { extractPageId, normalizeTitle } from "../text";

/** Explains, step by step, why a note does or does not match a Notion page. */
export class DiagnoseModal extends Modal {
  private index: TitleIndex | null = null;
  private linkResultEl!: HTMLElement;

  constructor(private readonly plugin: NotionImportPlugin, private readonly file: TFile) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("notion-import-diagnose");
    this.setTitle(`Notion matching for “${this.file.basename}”`);
    void this.run();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private line(parent: HTMLElement, ok: boolean | null, text: string): HTMLElement {
    const row = parent.createDiv({ cls: "notion-import-diag-line" });
    row.createSpan({ cls: "notion-import-diag-mark", text: ok == null ? "•" : ok ? "✓" : "✗" });
    row.createSpan({ text });
    return row;
  }

  private async run(): Promise<void> {
    const { contentEl } = this;
    const { app } = this;
    const settings = this.plugin.settings;
    contentEl.empty();

    const note = contentEl.createDiv({ cls: "notion-import-diag-section" });
    note.createEl("h4", { text: "Note" });
    const titles = titlesFor(app, this.file, settings);
    this.line(note, null, `Titles used for matching: ${titles.map(title => `“${title}”`).join(", ")}`);
    this.line(
      note,
      isInScannedFolders(this.file, settings),
      isInScannedFolders(this.file, settings)
        ? "Included by “Folders to scan”."
        : "Not in any of the “Folders to scan”, so Scan vault skips it. Compare with Notion still works on it.",
    );
    const rawLink = readLinkProperty(app, this.file, settings.propertyName);
    const linked = propertyCandidate(app, this.file, settings);
    if (!rawLink) this.line(note, null, `No “${settings.propertyName}” property, so it is matched by title.`);
    else if (!linked) this.line(note, false, `The “${settings.propertyName}” property doesn't contain a Notion page link or ID.`);
    else this.line(note, true, `Linked by the “${settings.propertyName}” property to page ${linked.pageId}. Title matching is skipped.`);

    const notion = contentEl.createDiv({ cls: "notion-import-diag-section" });
    notion.createEl("h4", { text: "Notion" });
    const loading = notion.createEl("p", { cls: "notion-import-muted", text: "Loading every page the integration can read (this can take a minute in a large workspace)…" });
    try {
      this.index = await this.plugin.getTitleIndex(true);
    } catch (error) {
      loading.remove();
      this.line(notion, false, error instanceof Error ? error.message : String(error));
      return;
    }
    loading.remove();
    const { stats } = this.index;
    this.line(
      notion,
      this.index.size > 0,
      `The integration can read ${this.index.size} pages: ${stats.fromSearch} from search, plus ${stats.fromDatabases} more found by listing database rows.`,
    );
    if (stats.failedDatabases.length) {
      this.line(notion, false, `These databases could not be listed: ${stats.failedDatabases.join(", ")}.`);
    }

    const result = contentEl.createDiv({ cls: "notion-import-diag-section" });
    result.createEl("h4", { text: "Title matches" });
    if (!settings.matchByTitle) this.line(result, false, "Match by title is turned off in settings.");
    const exact = titles.flatMap(title =>
      this.index!.lookup([title], null).map(hit => hit.page.title),
    );
    if (exact.length) this.line(result, true, `Exact title match: ${exact.map(title => `“${title}”`).join(", ")}`);
    else this.line(result, false, "No Notion page has exactly this title (ignoring case and punctuation).");

    const threshold = settings.fuzzyThreshold / 100;
    const closest = this.index.closest(titles[0], 5);
    if (closest.length) {
      result.createEl("p", {
        cls: "notion-import-muted",
        text: `Closest Notion titles (fuzzy matching is ${settings.fuzzyMatching ? `on, needing ${settings.fuzzyThreshold}%` : "off"}):`,
      });
      const list = result.createEl("ul");
      for (const { page, score } of closest) {
        const item = list.createEl("li");
        item.createEl("a", { text: page.title, href: page.url });
        const verdict = score >= 1 ? "exact" : settings.fuzzyMatching && score >= threshold ? "would match" : "below strictness";
        item.appendText(` — ${Math.round(score * 100)}% (${verdict})`);
      }
    }

    const check = contentEl.createDiv({ cls: "notion-import-diag-section" });
    check.createEl("h4", { text: "Check a specific Notion page" });
    check.createEl("p", { cls: "notion-import-muted", text: "Paste the link of the Notion page you expected this note to match." });
    const input = check.createEl("input", { type: "text", placeholder: "https://www.notion.so/…" });
    input.addClass("notion-import-diag-input");
    const button = check.createEl("button", { text: "Check" });
    this.linkResultEl = check.createDiv();
    const go = () => void this.checkLink(input.value, titles);
    button.addEventListener("click", go);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") go();
    });
  }

  private async checkLink(link: string, titles: string[]): Promise<void> {
    const out = this.linkResultEl;
    out.empty();
    const pageId = extractPageId(link);
    if (!pageId) {
      this.line(out, false, "That doesn't look like a Notion page link or ID.");
      return;
    }
    this.line(out, null, `Page ID: ${pageId}`);
    let page = this.index?.get(pageId);
    if (page) this.line(out, true, `This page is in the list the plugin matches against, titled “${page.title}”.`);
    else {
      try {
        page = summarizePage(await this.plugin.notion.getPage(pageId));
        this.line(
          out,
          false,
          `The integration can open this page (“${page.title}”), but Notion didn't include it when listing pages. ` +
            "Linking it in the note's frontmatter will always work.",
        );
      } catch (error) {
        this.line(out, false, error instanceof Error ? error.message : String(error));
        return;
      }
    }

    const settings = this.plugin.settings;
    const sameTitle = titles.some(title => normalizeTitle(title, settings.ignoreCase) === normalizeTitle(page.title, settings.ignoreCase));
    const score = Math.max(...titles.map(title => titleSimilarity(fuzzyKey(title), fuzzyKey(page.title))));
    if (sameTitle) this.line(out, true, "Its title matches the note exactly.");
    else
      this.line(
        out,
        settings.fuzzyMatching && score >= settings.fuzzyThreshold / 100,
        `Its title is ${Math.round(score * 100)}% similar to the note's; fuzzy matching needs ${settings.fuzzyThreshold}%` +
          (settings.fuzzyMatching ? "." : " and is turned off."),
      );
    if (!sameTitle) this.line(out, null, `Exact title as stored in Notion: ${JSON.stringify(page.title)}`);
  }
}
