import type { TFile } from "obsidian";
import type NotionImportPlugin from "./main";
import type { NotionCandidate } from "./match";
import { blocksToUnits, type ImportUnit } from "./notion/markdown";
import { summarizePage, type NotionPageSummary } from "./notion/types";
import { normalizeForCompare } from "./text";

/** A Notion page converted and checked against a note, ready for the compare window. */
export interface Comparison {
  pageId: string;
  page: NotionPageSummary;
  units: ImportUnit[];
  /** Per unit: whether its text already appears in the note. */
  inNote: boolean[];
}

export function markInNote(units: ImportUnit[], noteText: string): boolean[] {
  const note = normalizeForCompare(noteText);
  return units.map(unit => {
    const text = normalizeForCompare(unit.plain);
    return text.length >= 3 && note.includes(text);
  });
}

export async function loadComparison(plugin: NotionImportPlugin, file: TFile, candidate: NotionCandidate): Promise<Comparison> {
  const notion = plugin.notion;
  const page = summarizePage(await notion.getPage(candidate.pageId));
  const blocks = await notion.getBlockTree(candidate.pageId);
  const units = blocksToUnits(blocks, { calloutStyle: plugin.settings.calloutStyle });
  const noteText = await plugin.app.vault.cachedRead(file);
  return { pageId: candidate.pageId, page, units, inNote: markInNote(units, noteText) };
}

/** Nothing to import: the page is empty or every block's text is already in the note. */
export function isComplete(comparison: Comparison): boolean {
  return comparison.inNote.every(Boolean);
}
