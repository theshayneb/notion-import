import assert from "node:assert/strict";
import test from "node:test";
import { FuzzyIndex, fuzzyKey, titleSimilarity } from "../src/fuzzy.ts";

const sim = (a: string, b: string) => titleSimilarity(fuzzyKey(a), fuzzyKey(b));

test("fuzzyKey drops case, accents, punctuation and emoji", () => {
  assert.equal(fuzzyKey("🚀 Café — Q3: Plans!"), "cafe q3 plans");
});

test("one-character and one-word differences score high", () => {
  assert.ok(sim("Project Plan", "Project Plans") >= 0.9);
  assert.ok(sim("Recieve invoices", "Receive invoices") >= 0.85);
  assert.ok(sim("Project plan", "Project plan v2") >= 0.8);
  assert.ok(sim("Weekly team meeting", "Team meeting") >= 0.8);
  assert.ok(sim("Meeting notes Acme", "Acme meeting notes") >= 0.95);
  assert.ok(sim("Q3-Plans", "Q3 Plans") >= 0.95);
});

test("unrelated titles score low", () => {
  assert.ok(sim("Meeting notes", "Notes") < 0.8);
  assert.ok(sim("Budget 2024", "Holiday ideas") < 0.5);
  assert.ok(sim("Acme", "Acne") < 0.8);
});

test("FuzzyIndex finds the closest pages and respects the threshold", () => {
  const index = new FuzzyIndex<string>();
  for (const title of ["Project Plans", "Projects", "Grocery list", "Project plan v2"]) index.add(fuzzyKey(title), title);
  const hits = index.search(fuzzyKey("Project Plan"), 0.8, 3);
  assert.deepEqual(hits.map(hit => hit.item), ["Project Plans", "Project plan v2"]);
  assert.deepEqual(index.search(fuzzyKey("abc"), 0.5, 3), []);
});
