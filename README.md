# Notion Import

An Obsidian plugin that finds notes with a matching Notion page, shows the two side by side, and lets you import the Notion blocks or sections you choose into the note. Import only goes one way, from Notion into Obsidian. Nothing is ever written to Notion.

## How notes are matched

1. **Link property.** The note's `Notion` frontmatter property holds a Notion page URL or ID. You can change the property name in settings, and it matches whatever the capitalisation.
   ```yaml
   ---
   Notion: https://www.notion.so/My-Page-0123456789abcdef0123456789abcdef
   ---
   ```
2. **Title.** Notes without a link match pages whose Notion title equals the note's file name or one of its aliases. Matching ignores case and characters that file names can't contain, such as `:` and `/`.

If neither matches, you can pick a page by searching Notion.

## Using it

- **Matches panel.** The ribbon icon or the command **Open Notion matches** opens the panel. **Scan vault** lists every note linked to or sharing a title with a Notion page, and each row has a compare button.
- **Compare current note with Notion.** This works from the command palette or by right-clicking a note → **Compare with Notion**.
- **Compare window.** It shows the Obsidian note on the left and the Notion page on the right, with each Notion block on its own row.
  - Blocks whose text already appears in the note are marked **In note** and dimmed. You can hide them.
  - Tick single blocks, or use the **Section** button on a Notion heading to select the heading and everything under it. You can mix both.
  - **Select missing** ticks every block not already in the note.
  - Choose where to insert: the end of the note, the cursor (when the note is open), or the end of a section under one of the note's headings.
  - Notion headings are demoted automatically when inserted under a heading, so a Notion H1 under an Obsidian H2 becomes an H3. You can change how many levels.
  - Notion-hosted images and files are downloaded into your attachment folder, because Notion's links to them expire after an hour.
  - When the page was matched by title, the plugin can save its link into the `Notion` property so later matches use the link.
  - **Copy** puts the selection on the clipboard as Markdown instead of inserting it.

## Setup

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **New integration**, choose **Internal**, and give it read content access. Copy the **Internal integration secret**.
2. In Notion, share the pages you want with the integration: open the page's **•••** menu → **Connections** → add your integration. Sharing a parent page also shares every page under it.
3. In Obsidian → Settings → Notion Import, paste the secret and press **Test**.

The token is stored in `.obsidian/plugins/notion-import/data.json` inside your vault, so it syncs wherever your vault syncs.

## What converts

| Notion | Markdown |
| --- | --- |
| Text with bold, italic, strikethrough, code, links and inline equations | The same in Markdown |
| Headings 1–3, including toggle headings | `#`–`###` followed by their content |
| Bulleted, numbered and to-do lists, nested | `-`, `1.`, `- [ ]` indented with tabs |
| Toggles | A bullet with its content nested |
| Callouts | The callout's text and everything inside it. Optionally as an Obsidian `> [!note]` callout. |
| Quotes, code blocks, equations, dividers, tables | The Markdown equivalents |
| Images, PDFs, audio, video, files | Downloaded as attachments and embedded, or linked if they're external |
| Bookmarks, embeds, link previews | Links |
| Columns, synced blocks | Their content, in order |
| Sub-pages | A link to the Notion page |
| Databases | A placeholder line. Databases are not imported. |

## Install

### With BRAT

1. Install **BRAT** from Community plugins.
2. BRAT → **Add beta plugin** → `theshayneb/notion-import`. If the repository is private, first add a GitHub token in BRAT's settings.
3. Enable **Notion Import** in Community plugins.

### Manually

Download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/notion-import/`, then enable the plugin.

## Development

```sh
npm install
npm run build      # typecheck and build into dist/
npm test           # unit tests for conversion, link parsing and insertion
npm run lint
NOTION_IMPORT_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/notion-import npm run dev   # watch build into a vault
```

Each push to `main` publishes the version in `manifest.json` as a GitHub release. Bump the version in `manifest.json`, `package.json` and `versions.json` together.
