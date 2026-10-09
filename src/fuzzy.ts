// Fuzzy title matching. Pure (no Obsidian imports) so it can be unit-tested under Node.

/** Lowercase, accents removed, every run of punctuation or emoji collapsed to one space. */
export function fuzzyKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Edit distance, or `limit + 1` as soon as it is certain to exceed `limit`. */
function levenshtein(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * How alike two fuzzy keys are, from 0 to 1. Takes the better of:
 * - character similarity (edit distance), which forgives typos and one-character changes;
 * - word overlap (Dice coefficient on the sets of words), which forgives an added,
 *   missing or reordered word, e.g. "Project plan" vs "Project plan v2".
 * Scores below `floor` may be reported as 0, which lets the edit distance stop early.
 */
export function titleSimilarity(a: string, b: string, floor = 0): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const compactA = a.replace(/ /g, "");
  const compactB = b.replace(/ /g, "");
  // Only spacing or punctuation differs.
  if (compactA === compactB) return 0.99;

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  // A single shared word is not enough evidence on its own ("Notes" vs "Meeting notes").
  const words = shared >= 2 ? (2 * shared) / (wordsA.size + wordsB.size) : 0;

  const longest = Math.max(compactA.length, compactB.length);
  const limit = Math.floor((1 - Math.max(floor, words)) * longest);
  const distance = levenshtein(compactA, compactB, limit);
  const chars = distance > limit ? 0 : 1 - distance / longest;
  return Math.max(chars, words);
}

function trigrams(key: string): Set<string> {
  const padded = `  ${key} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

export interface FuzzyHit<T> {
  item: T;
  score: number;
}

/**
 * Finds items whose key is similar to a query. A trigram index narrows the field
 * first, so scanning a whole vault against thousands of pages stays fast.
 */
export class FuzzyIndex<T> {
  private readonly keys: string[] = [];
  private readonly items: T[] = [];
  private readonly gramCounts: number[] = [];
  private readonly postings = new Map<string, number[]>();

  add(key: string, item: T): void {
    if (!key) return;
    const id = this.items.length;
    this.keys.push(key);
    this.items.push(item);
    const grams = trigrams(key);
    this.gramCounts.push(grams.size);
    for (const gram of grams) {
      const list = this.postings.get(gram);
      if (list) list.push(id);
      else this.postings.set(gram, [id]);
    }
  }

  search(query: string, threshold: number, limit: number): FuzzyHit<T>[] {
    // Very short titles are too easy to confuse; they only match exactly.
    if (query.replace(/ /g, "").length < 4) return [];
    const queryGrams = trigrams(query);
    const sharedCounts = new Map<number, number>();
    for (const gram of queryGrams) {
      for (const id of this.postings.get(gram) ?? []) sharedCounts.set(id, (sharedCounts.get(id) ?? 0) + 1);
    }
    const hits: FuzzyHit<T>[] = [];
    for (const [id, shared] of sharedCounts) {
      // Titles one edit or one word apart still share most trigrams; skip the rest cheaply.
      if ((2 * shared) / (queryGrams.size + this.gramCounts[id]) < 0.4) continue;
      const score = titleSimilarity(query, this.keys[id], threshold);
      if (score >= threshold) hits.push({ item: this.items[id], score });
    }
    hits.sort((x, y) => y.score - x.score);
    return hits.slice(0, limit);
  }
}
