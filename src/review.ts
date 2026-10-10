import { Notice } from "obsidian";
import { isComplete, loadComparison, type Comparison } from "./compare";
import type NotionImportPlugin from "./main";
import type { NoteMatch } from "./match";
import { CompareModal, type ReviewChoice } from "./ui/compareModal";

type Loaded = { comparison: Comparison } | { error: string };

function load(plugin: NotionImportPlugin, match: NoteMatch): Promise<Loaded> {
  return loadComparison(plugin, match.file, match.candidates[0]).then(
    comparison => ({ comparison }),
    (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
  );
}

/**
 * Opens the compare window for each matched note in turn. The next note's Notion page
 * loads while the current one is open, and notes that already contain everything are
 * passed over when the setting asks for it.
 */
export async function reviewMatches(plugin: NotionImportPlugin, matches: NoteMatch[]): Promise<void> {
  const ignored = new Set(plugin.settings.ignoredNotes);
  const queue = matches.filter(match => !ignored.has(match.file.path));
  if (!queue.length) {
    new Notice("No matched notes to review.");
    return;
  }

  const tally: Record<ReviewChoice | "complete", number> = { imported: 0, linked: 0, skip: 0, ignore: 0, stop: 0, complete: 0 };
  let reviewed = 0;
  let next = load(plugin, queue[0]);
  for (let i = 0; i < queue.length; i++) {
    const match = queue[i];
    const loaded = await next;
    next = i + 1 < queue.length ? load(plugin, queue[i + 1]) : Promise.resolve({ error: "" });

    const comparison = "comparison" in loaded ? loaded.comparison : null;
    if (comparison && plugin.settings.skipComplete && isComplete(comparison)) {
      tally.complete++;
      continue;
    }

    const choice = await new Promise<ReviewChoice>(resolve =>
      new CompareModal(plugin, match.file, [...match.candidates], { position: i + 1, total: queue.length, resolve }, comparison).open(),
    );
    reviewed++;
    tally[choice]++;
    if (choice === "ignore") {
      plugin.settings.ignoredNotes = [...plugin.settings.ignoredNotes, match.file.path];
      await plugin.saveSettings();
    }
    if (choice === "stop") break;
  }

  const parts = [
    tally.imported && `${tally.imported} imported`,
    tally.linked && `${tally.linked} linked`,
    tally.skip && `${tally.skip} skipped`,
    tally.ignore && `${tally.ignore} skipped every time`,
    tally.complete && `${tally.complete} already had everything`,
  ].filter(Boolean);
  new Notice(`Notion review ${tally.stop ? "stopped" : "finished"}: ${reviewed} reviewed${parts.length ? `, ${parts.join(", ")}` : ""}.`);
}
