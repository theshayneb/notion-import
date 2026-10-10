import { Notice, Plugin, type TFile } from "obsidian";
import { TitleIndex, isMarkdownFile, matchFile, scanVault, type NotionCandidate, type ScanResult } from "./match";
import { NotionClient } from "./notion/client";
import { DEFAULT_SETTINGS, NotionImportSettingTab, type NotionImportSettings } from "./settings";
import { CompareModal } from "./ui/compareModal";
import { MATCHES_VIEW_TYPE, MatchesView } from "./ui/matchesView";
import { DiagnoseModal } from "./ui/diagnoseModal";
import { PageSuggestModal } from "./ui/pageSuggest";

export default class NotionImportPlugin extends Plugin {
  settings: NotionImportSettings = { ...DEFAULT_SETTINGS };
  lastScan: ScanResult | null = null;
  scanError = "";
  scanning = false;
  private client: NotionClient | null = null;
  private titleIndex: { index: Promise<TitleIndex>; builtAt: number } | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new NotionImportSettingTab(this.app, this));
    this.registerView(MATCHES_VIEW_TYPE, leaf => new MatchesView(leaf, this));

    this.addRibbonIcon("file-input", "Open Notion matches", () => void this.openMatchesView());

    this.addCommand({
      id: "open-matches",
      name: "Open Notion matches",
      callback: () => void this.openMatchesView(),
    });

    this.addCommand({
      id: "scan-vault",
      name: "Scan vault for Notion matches",
      callback: async () => {
        await this.openMatchesView();
        await this.scan();
      },
    });

    this.addCommand({
      id: "compare-current-note",
      name: "Compare current note with Notion",
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (!isMarkdownFile(file)) return false;
        if (!checking) void this.compareFile(file);
        return true;
      },
    });

    this.addCommand({
      id: "pick-page-for-current-note",
      name: "Pick a Notion page to compare with the current note",
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (!isMarkdownFile(file)) return false;
        if (!checking) this.pickPage(file);
        return true;
      },
    });

    this.addCommand({
      id: "diagnose-current-note",
      name: "Diagnose Notion matching for the current note",
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (!isMarkdownFile(file)) return false;
        if (!checking) new DiagnoseModal(this, file).open();
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!isMarkdownFile(file)) return;
        menu.addItem(item =>
          item
            .setTitle("Compare with Notion")
            .setIcon("file-input")
            .onClick(() => void this.compareFile(file)),
        );
        menu.addItem(item =>
          item
            .setTitle("Diagnose Notion matching")
            .setIcon("stethoscope")
            .onClick(() => new DiagnoseModal(this, file).open()),
        );
      }),
    );
  }

  /** One client per token, so its request throttling is shared. */
  get notion(): NotionClient {
    if (!this.client) this.client = new NotionClient(this.settings.token);
    return this.client;
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<NotionImportSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    this.client = null;
    this.titleIndex = null;
    await this.saveData(this.settings);
  }

  /**
   * All Notion page titles, fetched once and reused for 10 minutes so comparing
   * single notes stays quick. A vault scan always fetches a fresh list.
   */
  getTitleIndex(refresh = false): Promise<TitleIndex> {
    const fresh = this.titleIndex && Date.now() - this.titleIndex.builtAt < 10 * 60 * 1000;
    if (refresh || !fresh) {
      const index = TitleIndex.build(this.notion, this.settings.ignoreCase);
      const entry = { index, builtAt: Date.now() };
      this.titleIndex = entry;
      index.catch(() => {
        if (this.titleIndex === entry) this.titleIndex = null;
      });
    }
    return this.titleIndex!.index;
  }

  async openMatchesView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MATCHES_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: MATCHES_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MATCHES_VIEW_TYPE)) {
      if (leaf.view instanceof MatchesView) leaf.view.render();
    }
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.scanError = "";
    this.refreshViews();
    try {
      this.lastScan = await scanVault(this.app, this.settings, () => this.getTitleIndex(true));
    } catch (error) {
      this.scanError = error instanceof Error ? error.message : String(error);
    } finally {
      this.scanning = false;
      this.refreshViews();
    }
  }

  async compareFile(file: TFile): Promise<void> {
    let candidates: NotionCandidate[];
    try {
      candidates = await matchFile(this.app, this.settings, file, () => this.getTitleIndex());
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return;
    }
    if (candidates.length) this.openCompare(file, candidates);
    else {
      new Notice(`No Notion page is linked to or titled “${file.basename}”. Pick one instead.`);
      this.pickPage(file);
    }
  }

  pickPage(file: TFile): void {
    new PageSuggestModal(this.app, this.notion, file.basename, page => {
      this.openCompare(file, [{ pageId: page.id, title: page.title, url: page.url, via: "manual" }]);
    }).open();
  }

  openCompare(file: TFile, candidates: NotionCandidate[]): void {
    new CompareModal(this, file, candidates).open();
  }
}
