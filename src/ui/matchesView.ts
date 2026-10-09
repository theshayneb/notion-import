import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type NotionImportPlugin from "../main";
import type { NoteMatch } from "../match";

export const MATCHES_VIEW_TYPE = "notion-import-matches";

/** Side panel listing notes that are linked to, or share a title with, a Notion page. */
export class MatchesView extends ItemView {
  private filter = "";

  constructor(leaf: WorkspaceLeaf, private readonly plugin: NotionImportPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return MATCHES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Notion matches";
  }

  getIcon(): string {
    return "file-input";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("notion-import-view");

    const header = container.createDiv({ cls: "notion-import-view-header" });
    const scan = header.createEl("button", { cls: "mod-cta", text: this.plugin.scanning ? "Scanning…" : "Scan vault" });
    scan.disabled = this.plugin.scanning;
    scan.addEventListener("click", () => void this.plugin.scan());

    const search = header.createEl("input", { type: "search", placeholder: "Filter notes" });
    search.value = this.filter;
    search.addEventListener("input", () => {
      this.filter = search.value;
      this.renderList(list);
    });

    const status = container.createDiv({ cls: "notion-import-muted notion-import-view-status" });
    const result = this.plugin.lastScan;
    if (this.plugin.scanError) status.setText(this.plugin.scanError);
    else if (!result) status.setText("Scan the vault to find notes with a matching Notion page.");
    else {
      const linked = result.matches.filter(match => match.candidates[0].via === "property").length;
      const titled = result.matches.length - linked;
      const pages = result.pageCount == null ? "" : ` (out of ${result.pageCount} Notion pages shared with the integration)`;
      status.setText(`${linked} linked by property, ${titled} matched by title${pages}.`);
    }

    const list = container.createDiv({ cls: "notion-import-view-list" });
    this.renderList(list);
  }

  private renderList(list: HTMLElement): void {
    list.empty();
    const matches = this.plugin.lastScan?.matches ?? [];
    const filter = this.filter.trim().toLowerCase();
    const shown = filter ? matches.filter(match => match.file.path.toLowerCase().includes(filter)) : matches;
    for (const match of shown) this.renderMatch(list, match);
  }

  private renderMatch(list: HTMLElement, match: NoteMatch): void {
    const row = list.createDiv({ cls: "notion-import-view-row" });
    const name = row.createDiv({ cls: "notion-import-view-name" });
    const link = name.createEl("a", { text: match.file.basename });
    link.addEventListener("click", event => {
      event.preventDefault();
      void this.app.workspace.getLeaf(false).openFile(match.file);
    });
    if (match.file.parent && !match.file.parent.isRoot()) {
      name.createDiv({ cls: "notion-import-muted notion-import-view-path", text: match.file.parent.path });
    }

    const via = match.candidates[0].via;
    const titles = match.candidates.map(candidate => candidate.title).filter(Boolean);
    const badge = row.createSpan({
      cls: `notion-import-badge is-${via}`,
      text: via === "property" ? "Linked" : match.candidates.length > 1 ? `Title ×${match.candidates.length}` : "Title",
    });
    if (titles.length) badge.setAttr("aria-label", titles.join(", "));

    const compare = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Compare with Notion" } });
    setIcon(compare, "git-compare");
    compare.addEventListener("click", () => this.plugin.openCompare(match.file, match.candidates));
  }
}
