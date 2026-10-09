import { Component, MarkdownRenderer, MarkdownView, Modal, Notice, requestUrl, setIcon, type TFile } from "obsidian";
import type NotionImportPlugin from "../main";
import type { NotionCandidate } from "../match";
import { blocksToUnits, joinUnits, sectionRange, shiftHeading, type AssetRef, type ImportUnit } from "../notion/markdown";
import { summarizePage } from "../notion/types";
import { appendBlock, findHeadings, insertUnderHeading, normalizeForCompare, type HeadingInfo } from "../text";

type Target = { kind: "end" } | { kind: "cursor" } | { kind: "heading"; heading: HeadingInfo; occurrence: number };

const VIA_LABEL: Record<NotionCandidate["via"], string> = {
  property: "linked in frontmatter",
  title: "matched by title",
  manual: "picked by you",
};

export class CompareModal extends Modal {
  private readonly component = new Component();
  private candidate: NotionCandidate;
  private units: ImportUnit[] = [];
  private inNote: boolean[] = [];
  private selected = new Set<number>();
  private noteText = "";
  private headings: HeadingInfo[] = [];
  private hideExisting = false;
  private target: Target = { kind: "end" };
  private headingOffset = 0;
  private writeLink: boolean;
  private download: boolean;
  private loadToken = 0;
  private rows: { row: HTMLElement; checkbox: HTMLInputElement }[] = [];
  private emptyNotice: HTMLElement | null = null;

  private notePaneBody!: HTMLElement;
  private notionTitleEl!: HTMLElement;
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private importButton!: HTMLButtonElement;
  private targetSelect!: HTMLSelectElement;
  private offsetSelect!: HTMLSelectElement;
  private writeLinkRow!: HTMLElement;

  constructor(private readonly plugin: NotionImportPlugin, private readonly file: TFile, private readonly candidates: NotionCandidate[]) {
    super(plugin.app);
    this.candidate = candidates[0];
    this.writeLink = plugin.settings.writeLinkOnMatch;
    this.download = plugin.settings.downloadAttachments;
  }

  onOpen(): void {
    this.component.load();
    this.modalEl.addClass("notion-import-modal");
    this.setTitle(`Compare “${this.file.basename}” with Notion`);
    const { contentEl } = this;
    contentEl.empty();

    if (this.candidates.length > 1) {
      const pick = contentEl.createDiv({ cls: "notion-import-candidates" });
      pick.createSpan({ text: `${this.candidates.length} Notion pages match. Compare with: ` });
      const select = pick.createEl("select", { cls: "dropdown" });
      this.candidates.forEach((candidate, index) => select.createEl("option", { value: String(index), text: candidate.title || candidate.pageId }));
      select.addEventListener("change", () => {
        this.candidate = this.candidates[Number(select.value)];
        void this.loadNotion();
      });
    }

    const panes = contentEl.createDiv({ cls: "notion-import-panes" });

    const notePane = panes.createDiv({ cls: "notion-import-pane" });
    const noteHeader = notePane.createDiv({ cls: "notion-import-pane-header" });
    noteHeader.createSpan({ cls: "notion-import-pane-label", text: "Obsidian" });
    noteHeader.createSpan({ cls: "notion-import-pane-title", text: this.file.basename });
    this.notePaneBody = notePane.createDiv({ cls: "notion-import-pane-body markdown-rendered" });

    const notionPane = panes.createDiv({ cls: "notion-import-pane" });
    const notionHeader = notionPane.createDiv({ cls: "notion-import-pane-header" });
    notionHeader.createSpan({ cls: "notion-import-pane-label", text: "Notion" });
    this.notionTitleEl = notionHeader.createSpan({ cls: "notion-import-pane-title" });

    const toolbar = notionPane.createDiv({ cls: "notion-import-toolbar" });
    this.toolbarButton(toolbar, "Select missing", () => {
      this.selected = new Set(this.units.map((_, i) => i).filter(i => !this.inNote[i]));
      this.refresh();
    });
    this.toolbarButton(toolbar, "Select all", () => {
      this.selected = new Set(this.units.map((_, i) => i));
      this.refresh();
    });
    this.toolbarButton(toolbar, "Clear", () => {
      this.selected.clear();
      this.refresh();
    });
    const hideLabel = toolbar.createEl("label", { cls: "notion-import-check" });
    const hide = hideLabel.createEl("input", { type: "checkbox" });
    hideLabel.appendText("Hide blocks already in note");
    hide.addEventListener("change", () => {
      this.hideExisting = hide.checked;
      this.refresh();
    });

    this.listEl = notionPane.createDiv({ cls: "notion-import-pane-body notion-import-units" });

    this.buildFooter(contentEl);
    void this.loadNote().then(() => this.loadNotion());
  }

  onClose(): void {
    this.loadToken++;
    this.component.unload();
    this.contentEl.empty();
  }

  private toolbarButton(parent: HTMLElement, text: string, onClick: () => void): void {
    parent.createEl("button", { text }).addEventListener("click", onClick);
  }

  private buildFooter(parent: HTMLElement): void {
    const footer = parent.createDiv({ cls: "notion-import-footer" });
    const options = footer.createDiv({ cls: "notion-import-options" });

    const targetLabel = options.createEl("label", { text: "Insert: " });
    this.targetSelect = targetLabel.createEl("select", { cls: "dropdown" });
    this.targetSelect.addEventListener("change", () => this.onTargetChange());

    const offsetLabel = options.createEl("label", { text: "Demote Notion headings by " });
    this.offsetSelect = offsetLabel.createEl("select", { cls: "dropdown" });
    for (let i = 0; i <= 3; i++) this.offsetSelect.createEl("option", { value: String(i), text: String(i) });
    this.offsetSelect.addEventListener("change", () => (this.headingOffset = Number(this.offsetSelect.value)));

    const downloadLabel = options.createEl("label", { cls: "notion-import-check" });
    const download = downloadLabel.createEl("input", { type: "checkbox" });
    download.checked = this.download;
    downloadLabel.appendText("Save images and files as attachments");
    download.addEventListener("change", () => (this.download = download.checked));

    this.writeLinkRow = options.createEl("label", { cls: "notion-import-check" });
    const writeLink = this.writeLinkRow.createEl("input", { type: "checkbox" });
    writeLink.checked = this.writeLink;
    this.writeLinkRow.appendText(`Save the page link to “${this.plugin.settings.propertyName}”`);
    writeLink.addEventListener("change", () => (this.writeLink = writeLink.checked));

    const actions = footer.createDiv({ cls: "notion-import-actions" });
    this.countEl = actions.createSpan({ cls: "notion-import-count" });
    actions.createEl("button", { text: "Copy" }).addEventListener("click", () => void this.copySelection());
    this.importButton = actions.createEl("button", { cls: "mod-cta", text: "Import" });
    this.importButton.addEventListener("click", () => void this.importSelection());
  }

  private editorForFile(): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === this.file.path) return leaf.view;
    }
    return null;
  }

  private async loadNote(): Promise<void> {
    this.noteText = await this.app.vault.cachedRead(this.file);
    this.headings = findHeadings(this.noteText);
    this.notePaneBody.empty();
    if (!this.noteText.trim()) this.notePaneBody.createEl("p", { cls: "notion-import-muted", text: "This note is empty." });
    else await MarkdownRenderer.render(this.app, this.noteText, this.notePaneBody, this.file.path, this.component);
    this.fillTargets();
  }

  private fillTargets(): void {
    const select = this.targetSelect;
    select.empty();
    select.createEl("option", { value: "end", text: "End of the note" });
    if (this.editorForFile()) select.createEl("option", { value: "cursor", text: "At the cursor" });
    this.headings.forEach((heading, index) => {
      select.createEl("option", { value: `h${index}`, text: `Under ${"#".repeat(heading.level)} ${heading.text}` });
    });
    const preferred = this.plugin.settings.defaultInsert === "cursor" && this.editorForFile() ? "cursor" : "end";
    select.value = preferred;
    this.onTargetChange();
  }

  private onTargetChange(): void {
    const value = this.targetSelect.value;
    if (value === "cursor") this.target = { kind: "cursor" };
    else if (value.startsWith("h")) {
      const index = Number(value.slice(1));
      const heading = this.headings[index];
      const occurrence = this.headings.slice(0, index).filter(other => other.text === heading.text).length;
      this.target = { kind: "heading", heading, occurrence };
    } else this.target = { kind: "end" };
    // Notion H1 under an Obsidian H2 should become an H3.
    this.headingOffset = this.target.kind === "heading" ? Math.min(3, this.target.heading.level) : 0;
    this.offsetSelect.value = String(this.headingOffset);
  }

  private async loadNotion(): Promise<void> {
    const token = ++this.loadToken;
    this.units = [];
    this.rows = [];
    this.selected.clear();
    this.listEl.empty();
    this.listEl.createEl("p", { cls: "notion-import-muted", text: "Loading the Notion page…" });
    this.notionTitleEl.setText(this.candidate.title || "…");
    this.writeLinkRow.toggle(this.candidate.via !== "property");
    this.updateCount();
    try {
      const notion = this.plugin.notion;
      const page = summarizePage(await notion.getPage(this.candidate.pageId));
      const blocks = await notion.getBlockTree(this.candidate.pageId);
      if (token !== this.loadToken) return;
      this.candidate = { ...this.candidate, title: page.title, url: page.url };
      this.notionTitleEl.empty();
      const link = this.notionTitleEl.createEl("a", { text: page.title, href: page.url });
      link.setAttr("target", "_blank");
      this.notionTitleEl.createSpan({ cls: "notion-import-via", text: ` · ${VIA_LABEL[this.candidate.via]}` });
      this.units = blocksToUnits(blocks, { calloutStyle: this.plugin.settings.calloutStyle });
      const note = normalizeForCompare(this.noteText);
      this.inNote = this.units.map(unit => {
        const text = normalizeForCompare(unit.plain);
        return text.length >= 3 && note.includes(text);
      });
      await this.renderList(token);
    } catch (error) {
      if (token !== this.loadToken) return;
      this.listEl.empty();
      this.listEl.createEl("p", { cls: "notion-import-error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Renders every block once; selection and filtering afterwards only toggle classes. */
  private async renderList(token: number): Promise<void> {
    this.listEl.empty();
    this.rows = [];
    if (!this.units.length) {
      this.listEl.createEl("p", { cls: "notion-import-muted", text: "This Notion page has no content to import." });
      this.updateCount();
      return;
    }
    for (const [index, unit] of this.units.entries()) {
      const row = this.listEl.createDiv({ cls: "notion-import-unit" });
      row.toggleClass("is-heading", unit.headingLevel != null);
      row.toggleClass("is-in-note", this.inNote[index]);

      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.addEventListener("change", () => this.setSelected([index], checkbox.checked));

      const body = row.createDiv({ cls: "notion-import-unit-body markdown-rendered" });
      await MarkdownRenderer.render(this.app, unit.markdown, body, this.file.path, this.component);
      if (token !== this.loadToken) return;

      const meta = row.createDiv({ cls: "notion-import-unit-meta" });
      if (this.inNote[index]) meta.createSpan({ cls: "notion-import-badge", text: "In note" });
      if (unit.headingLevel != null) {
        const range = sectionRange(this.units, index);
        if (range.length > 1) {
          const button = meta.createEl("button", { cls: "notion-import-section", attr: { "aria-label": "Select or clear this whole section" } });
          setIcon(button, "list-checks");
          button.createSpan({ text: `Section (${range.length})` });
          button.addEventListener("click", () => this.setSelected(range, !range.every(i => this.selected.has(i))));
        }
      }

      row.addEventListener("click", event => {
        const target = event.target as HTMLElement;
        if (target.closest("a, button, input")) return;
        this.setSelected([index], !this.selected.has(index));
      });
      this.rows.push({ row, checkbox });
    }
    this.emptyNotice = this.listEl.createEl("p", {
      cls: "notion-import-muted",
      text: "Everything on this Notion page already appears in the note.",
    });
    this.refresh();
  }

  private refresh(): void {
    let shown = 0;
    this.rows.forEach(({ row, checkbox }, index) => {
      const selected = this.selected.has(index);
      checkbox.checked = selected;
      row.toggleClass("is-selected", selected);
      const visible = !(this.hideExisting && this.inNote[index]);
      row.toggle(visible);
      if (visible) shown++;
    });
    this.emptyNotice?.toggle(this.rows.length > 0 && shown === 0);
    this.updateCount();
  }

  private setSelected(indices: number[], selected: boolean): void {
    for (const index of indices) {
      if (selected) this.selected.add(index);
      else this.selected.delete(index);
    }
    this.refresh();
  }

  private updateCount(): void {
    const count = this.selected.size;
    this.countEl.setText(count ? `${count} block${count === 1 ? "" : "s"} selected` : "Nothing selected");
    this.importButton.disabled = count === 0;
  }

  private selectedUnits(): ImportUnit[] {
    return this.units.filter((_, index) => this.selected.has(index));
  }

  private async buildMarkdown(saveAssets: boolean): Promise<{ markdown: string; failed: number }> {
    let failed = 0;
    const parts: { markdown: string; listKind: ImportUnit["listKind"] }[] = [];
    for (const unit of this.selectedUnits()) {
      let markdown = shiftHeading(unit.markdown, this.headingOffset);
      if (saveAssets) {
        for (const asset of unit.assets) {
          try {
            markdown = markdown.split(asset.snippet).join(await this.saveAsset(asset));
          } catch {
            failed++;
          }
        }
      }
      parts.push({ markdown, listKind: unit.listKind });
    }
    return { markdown: joinUnits(parts), failed };
  }

  private async saveAsset(asset: AssetRef): Promise<string> {
    const response = await requestUrl({ url: asset.url });
    const name = asset.fileName.replace(/[\\/:*?"<>|#^[\]]/g, "-") || "notion-file";
    const path = await this.app.fileManager.getAvailablePathForAttachment(name, this.file.path);
    const saved = await this.app.vault.createBinary(path, response.arrayBuffer);
    return (asset.embed ? "!" : "") + this.app.fileManager.generateMarkdownLink(saved, this.file.path);
  }

  private async copySelection(): Promise<void> {
    if (!this.selected.size) return;
    const { markdown } = await this.buildMarkdown(false);
    await navigator.clipboard.writeText(markdown);
    new Notice("Copied the selected Notion blocks.");
  }

  private async importSelection(): Promise<void> {
    if (!this.selected.size) return;
    this.importButton.disabled = true;
    this.importButton.setText("Importing…");
    try {
      const { markdown, failed } = await this.buildMarkdown(this.download);
      const target = this.target;
      if (target.kind === "cursor") {
        const view = this.editorForFile();
        if (!view) throw new Error("The note is no longer open, so there is no cursor to insert at.");
        view.editor.replaceRange(markdown, view.editor.getCursor());
      } else if (target.kind === "heading") {
        await this.app.vault.process(this.file, text =>
          insertUnderHeading(text, { text: target.heading.text, occurrence: target.occurrence }, markdown),
        );
      } else {
        await this.app.vault.process(this.file, text => appendBlock(text, markdown));
      }

      if (this.writeLink && this.candidate.via !== "property" && this.candidate.url) {
        const wanted = this.plugin.settings.propertyName;
        await this.app.fileManager.processFrontMatter(this.file, (frontmatter: Record<string, unknown>) => {
          const key = Object.keys(frontmatter).find(name => name.toLowerCase() === wanted.toLowerCase()) ?? wanted;
          frontmatter[key] = this.candidate.url;
        });
      }

      const count = this.selected.size;
      new Notice(
        `Imported ${count} Notion block${count === 1 ? "" : "s"} into “${this.file.basename}”.` +
          (failed ? ` ${failed} file${failed === 1 ? "" : "s"} could not be downloaded and kept their Notion links.` : ""),
      );
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      this.importButton.setText("Import");
      this.updateCount();
    }
  }
}
