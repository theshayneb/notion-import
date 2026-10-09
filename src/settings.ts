import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type NotionImportPlugin from "./main";
import type { CalloutStyle } from "./notion/markdown";

export type DefaultInsert = "end" | "cursor";

export interface NotionImportSettings {
  token: string;
  propertyName: string;
  matchByTitle: boolean;
  matchAliases: boolean;
  ignoreCase: boolean;
  writeLinkOnMatch: boolean;
  downloadAttachments: boolean;
  calloutStyle: CalloutStyle;
  defaultInsert: DefaultInsert;
  includedFolders: string;
}

export const DEFAULT_SETTINGS: NotionImportSettings = {
  token: "",
  propertyName: "Notion",
  matchByTitle: true,
  matchAliases: true,
  ignoreCase: true,
  writeLinkOnMatch: true,
  downloadAttachments: true,
  calloutStyle: "plain",
  defaultInsert: "end",
  includedFolders: "",
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
      .setName("Folders to scan")
      .setDesc("One folder path per line. Scanning only looks at notes in these folders and their subfolders. Leave empty to scan the whole vault.")
      .addTextArea(text =>
        text.setPlaceholder("Example: projects/work").setValue(settings.includedFolders).onChange(async value => {
          settings.includedFolders = value;
          await save();
        }),
      );

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
