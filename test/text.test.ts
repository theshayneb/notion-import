import assert from "node:assert/strict";
import test from "node:test";
import { appendBlock, extractPageId, findHeadings, insertUnderHeading, normalizeForCompare, normalizeTitle } from "../src/text.ts";

const ID = "0123456789abcdef0123456789abcdef";
const UUID = "01234567-89ab-cdef-0123-456789abcdef";

test("extractPageId reads Notion URLs and bare IDs", () => {
  assert.equal(extractPageId(`https://www.notion.so/team/My-Page-${ID}?pvs=4`), UUID);
  assert.equal(extractPageId(`https://www.notion.so/${ID}`), UUID);
  assert.equal(extractPageId(UUID), UUID);
  assert.equal(extractPageId(`https://acme.notion.site/Page-${ID}#ffffffffffffffffffffffffffffffff`), UUID);
  assert.equal(extractPageId(`https://www.notion.so/db-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&p=${ID}`), UUID);
  assert.equal(extractPageId(`[Notion](https://www.notion.so/Page-${ID})`), UUID);
  assert.equal(extractPageId("not a link"), null);
  assert.equal(extractPageId(""), null);
});

test("normalizeTitle tolerates characters Obsidian file names cannot hold", () => {
  assert.equal(normalizeTitle("Q3: Plans / Goals", true), normalizeTitle("Q3  Plans   Goals", true));
  assert.equal(normalizeTitle("Hello", true), "hello");
  assert.equal(normalizeTitle("Hello", false), "Hello");
});

test("normalizeForCompare ignores Markdown formatting", () => {
  assert.equal(normalizeForCompare("- **Bold** [link](https://x.y) `code`"), normalizeForCompare("Bold link code"));
});

test("findHeadings skips front matter and code fences", () => {
  const md = "---\ntitle: x\n---\n# One\n```\n# not a heading\n```\n## Two ##\n";
  assert.deepEqual(findHeadings(md), [
    { level: 1, text: "One", line: 3 },
    { level: 2, text: "Two", line: 7 },
  ]);
});

test("appendBlock separates with one blank line", () => {
  assert.equal(appendBlock("Hello\n\n\n", "New"), "Hello\n\nNew\n");
  assert.equal(appendBlock("", "New"), "New\n");
});

test("insertUnderHeading inserts at the end of the section", () => {
  const md = "# A\nintro\n\n## B\nb text\n\n## C\nc text\n";
  assert.equal(insertUnderHeading(md, { text: "B", occurrence: 0 }, "NEW"), "# A\nintro\n\n## B\nb text\n\nNEW\n\n## C\nc text\n");
  // A level-1 section runs past its level-2 children.
  assert.equal(insertUnderHeading(md, { text: "A", occurrence: 0 }, "NEW"), "# A\nintro\n\n## B\nb text\n\n## C\nc text\n\nNEW\n");
  assert.equal(insertUnderHeading("## X\n", { text: "X", occurrence: 0 }, "NEW"), "## X\n\nNEW\n");
});

test("insertUnderHeading picks the right duplicate heading", () => {
  const md = "## Notes\none\n## Notes\ntwo\n";
  assert.equal(insertUnderHeading(md, { text: "Notes", occurrence: 1 }, "NEW"), "## Notes\none\n## Notes\ntwo\n\nNEW\n");
});
