import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type NotionImportPlugin from "./main";
import type { CalloutStyle } from "./notion/markdown";
import { parseFolderList, pathInFolders } from "./text";

export type DefaultInsert = "end" | "cursor";

export interface NotionImportSettings {
  token: string;
  propertyName: string;
  matchByTitle: boolean;
  matchAliases: boolean;
  ignoreCase: boolean;
  fuzzyMatching: boolean;
  /** Minimum title similarity, as a percentage, for a fuzzy match. */
  fuzzyThreshold: number;
  writeLinkOnMatch: boolean;
  downloadAttachments: boolean;
  calloutStyle: CalloutStyle;
  defaultInsert: DefaultInsert;
  includedFolders: string;
  /** Notes marked "Skip every time" in a review, by path. */
  ignoredNotes: string[];
  skipComplete: boolean;
  preselectMissing: boolean;
}

export const DEFAULT_SETTINGS: NotionImportSettings = {
  token: "",
  propertyName: "Notion",
  matchByTitle: true,
  matchAliases: true,
  ignoreCase: true,
  fuzzyMatching: true,
  fuzzyThreshold: 80,
  writeLinkOnMatch: true,
  downloadAttachments: true,
  calloutStyle: "plain",
  defaultInsert: "end",
  includedFolders: "",
  ignoredNotes: [],
  skipComplete: true,
  preselectMissing: true,
};

export class NotionImportSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: NotionImportPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl)
      .setName("Notion integration token")
      .setDesc(
        "Create an internal integration at notion.so/profile/integrations and paste its secret here. " +
          "Then share pages with it from each page's menu → Connections. The token is stored in this vault's plugin data.",
      )
      .addText(text => {
        text.inputEl.type = "password";
        text.setPlaceholder("Paste the secret").setValue(settings.token).onChange(async value => {
          settings.token = value.trim();
          await save();
        });
      })
      .addButton(button =>
        button.setButtonText("Test").onClick(async () => {
          try {
            const workspace = await this.plugin.notion.whoAmI();
            new Notice(`Connected to ${workspace}.`);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );

    new Setting(containerEl).setName("Matching").setHeading();

    new Setting(containerEl)
      .setName("Link property")
      .setDesc("Frontmatter property that holds the Notion page link. Matched without regard to case.")
      .addText(text =>
        text.setValue(settings.propertyName).onChange(async value => {
          settings.propertyName = value.trim() || DEFAULT_SETTINGS.propertyName;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Match by title")
      .setDesc("When a note has no link, look for a Notion page whose title matches the note's file name.")
      .addToggle(toggle =>
        toggle.setValue(settings.matchByTitle).onChange(async value => {
          settings.matchByTitle = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Also match aliases")
      .setDesc("Treat the note's aliases as titles too.")
      .addToggle(toggle =>
        toggle.setValue(settings.matchAliases).onChange(async value => {
          settings.matchAliases = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Ignore case when matching titles")
      .addToggle(toggle =>
        toggle.setValue(settings.ignoreCase).onChange(async value => {
          settings.ignoreCase = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Fuzzy title matching")
      .setDesc(
        "When no title matches exactly, also match similar titles: a typo, a changed character, or an added, " +
          "missing or reordered word. Punctuation, accents and emoji are ignored.",
      )
      .addToggle(toggle =>
        toggle.setValue(settings.fuzzyMatching).onChange(async value => {
          settings.fuzzyMatching = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Fuzzy match strictness")
      .setDesc("How similar titles must be, in percent. Lower finds more matches but more wrong ones. The default is 80.")
      .addSlider(slider =>
        slider
          .setLimits(50, 95, 5)
          .setValue(settings.fuzzyThreshold)
          .onChange(async value => {
            settings.fuzzyThreshold = value;
            await save();
          }),
      );

    const folders = new Setting(containerEl)
      .setName("Folders to scan")
      .setDesc(
        "One folder per line. Scan vault only looks at notes inside these folders and their subfolders. " +
          "A folder name matches at any depth and ignores case, so “recipes” also covers “Food/Recipes”. " +
          "Leave empty to scan the whole vault.",
      );
    const folderCounts = folders.descEl.createDiv({ cls: "notion-import-folder-counts" });
    const showCounts = () => {
      folderCounts.empty();
      const files = this.app.vault.getMarkdownFiles();
      for (const folder of parseFolderList(settings.includedFolders)) {
        const count = files.filter(file => pathInFolders(file.path, [folder])).length;
        folderCounts.createDiv({
          cls: count ? "" : "notion-import-error",
          text: `${folder}: ${count === 0 ? "no notes found. Check the folder name." : `${count} note${count === 1 ? "" : "s"}`}`,
        });
      }
    };
    folders.addTextArea(text =>
      text.setPlaceholder("Example: recipes").setValue(settings.includedFolders).onChange(async value => {
        settings.includedFolders = value;
        showCounts();
        await save();
      }),
    );
    showCounts();

    new Setting(containerEl).setName("Reviewing").setHeading();

    new Setting(containerEl)
      .setName("Pass over notes that already have everything")
      .setDesc("In a review, don't stop at notes that already contain every block of their Notion page.")
      .addToggle(toggle =>
        toggle.setValue(settings.skipComplete).onChange(async value => {
          settings.skipComplete = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Tick missing blocks to start with")
      .setDesc("Open the compare window with every block that isn't already in the note ticked. Untick what you don't want.")
      .addToggle(toggle =>
        toggle.setValue(settings.preselectMissing).onChange(async value => {
          settings.preselectMissing = value;
          await save();
        }),
      );

    const skipped = new Setting(containerEl)
      .setName("Notes skipped every time")
      .setDesc(
        settings.ignoredNotes.length
          ? "Reviews and scans pass over these notes. Remove one to have it reviewed again."
          : "Nothing yet. Choose “Skip every time” in a review to have reviews pass over a note.",
      );
    const skippedList = skipped.descEl.createDiv({ cls: "notion-import-skipped" });
    for (const path of settings.ignoredNotes) {
      const row = skippedList.createDiv({ cls: "notion-import-skipped-row" });
      row.createEl("code", { text: path });
      row.createEl("button", { text: "Remove" }).addEventListener("click", () => {
        settings.ignoredNotes = settings.ignoredNotes.filter(other => other !== path);
        row.remove();
        void save();
      });
    }

    new Setting(containerEl).setName("Importing").setHeading();

    new Setting(containerEl)
      .setName("Save the Notion link after a title match")
      .setDesc("Default for the checkbox in the compare window that writes the page link into the link property.")
      .addToggle(toggle =>
        toggle.setValue(settings.writeLinkOnMatch).onChange(async value => {
          settings.writeLinkOnMatch = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Download Notion images and files")
      .setDesc("Notion's file links expire after an hour, so imported images and files are saved as attachments.")
      .addToggle(toggle =>
        toggle.setValue(settings.downloadAttachments).onChange(async value => {
          settings.downloadAttachments = value;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Callouts")
      .setDesc("How Notion callouts are imported.")
      .addDropdown(dropdown =>
        dropdown
          .addOption("plain", "Just the text")
          .addOption("callout", "As an Obsidian callout")
          .setValue(settings.calloutStyle)
          .onChange(async value => {
            settings.calloutStyle = value as CalloutStyle;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("Default insert position")
      .addDropdown(dropdown =>
        dropdown
          .addOption("end", "End of note")
          .addOption("cursor", "At cursor (when the note is open)")
          .setValue(settings.defaultInsert)
          .onChange(async value => {
            settings.defaultInsert = value as DefaultInsert;
            await save();
          }),
      );
  }
}
