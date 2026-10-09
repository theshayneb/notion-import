import { SuggestModal, debounce, type App } from "obsidian";
import type { NotionClient } from "../notion/client";
import type { NotionPageSummary } from "../notion/types";

/** Searches pages shared with the integration and hands the chosen one back. */
export class PageSuggestModal extends SuggestModal<NotionPageSummary> {
  private results: NotionPageSummary[] = [];
  private error = "";
  private lastQuery: string | null = null;
  private readonly search = debounce((query: string) => void this.runSearch(query), 400, true);

  constructor(
    app: App,
    private readonly client: NotionClient,
    private readonly initialQuery: string,
    private readonly onPick: (page: NotionPageSummary) => void,
  ) {
    super(app);
    this.setPlaceholder("Search Notion pages shared with the integration");
    this.emptyStateText = "No matching Notion pages.";
  }

  onOpen(): void {
    void super.onOpen();
    this.inputEl.value = this.initialQuery;
    this.lastQuery = this.initialQuery;
    this.inputEl.select();
    void this.runSearch(this.initialQuery);
  }

  private async runSearch(query: string): Promise<void> {
    try {
      this.results = await this.client.searchPages(query, 20);
      this.error = "";
    } catch (error) {
      this.results = [];
      this.error = error instanceof Error ? error.message : String(error);
    }
    if (this.inputEl.value === query) {
      this.emptyStateText = this.error || "No matching Notion pages.";
      // Re-run getSuggestions with the fresh results.
      this.inputEl.dispatchEvent(new Event("input"));
    }
  }

  getSuggestions(query: string): NotionPageSummary[] {
    if (query !== this.lastQuery) {
      this.lastQuery = query;
      this.search(query);
    }
    return this.results;
  }

  renderSuggestion(page: NotionPageSummary, el: HTMLElement): void {
    el.createDiv({ text: page.title });
    el.createEl("small", { cls: "notion-import-muted", text: page.url });
  }

  onChooseSuggestion(page: NotionPageSummary): void {
    this.onPick(page);
  }
}
