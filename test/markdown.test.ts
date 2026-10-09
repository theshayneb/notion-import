import assert from "node:assert/strict";
import test from "node:test";
import { blocksToUnits, joinUnits, sectionRange, shiftHeading } from "../src/notion/markdown.ts";
import type { NotionBlock, RichText } from "../src/notion/types.ts";

const plain = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
const rt = (text: string, extra: Partial<RichText["annotations"]> = {}, href: string | null = null): RichText => ({
  type: "text",
  plain_text: text,
  href,
  annotations: { ...plain, ...extra },
});
let n = 0;
const block = (type: string, payload: Record<string, unknown>, children?: NotionBlock[]): NotionBlock => ({
  object: "block",
  id: `b${n++}`,
  type,
  has_children: Boolean(children?.length),
  [type]: payload,
  children,
});
const para = (...parts: RichText[]) => block("paragraph", { rich_text: parts });
const opts = { calloutStyle: "plain" as const };

test("rich text annotations and links", () => {
  const [unit] = blocksToUnits([para(rt("bold ", { bold: true }), rt("code", { code: true }), rt(" link", {}, "https://x.y"))], opts);
  assert.equal(unit.markdown, "**bold** `code` [link](https://x.y)");
});

test("headings, nested lists and to-dos", () => {
  const units = blocksToUnits(
    [
      block("heading_2", { rich_text: [rt("Title")] }),
      block("bulleted_list_item", { rich_text: [rt("one")] }, [block("to_do", { rich_text: [rt("sub")], checked: true })]),
      block("numbered_list_item", { rich_text: [rt("two")] }),
      para(),
    ],
    opts,
  );
  assert.deepEqual(
    units.map(u => u.markdown),
    ["## Title", "- one\n\t- [x] sub", "1. two"],
  );
  assert.equal(units[0].headingLevel, 2);
  assert.equal(joinUnits(units), "## Title\n\n- one\n\t- [x] sub\n1. two");
});

test("callout text and the text under it are kept", () => {
  const callout = block("callout", { rich_text: [rt("Heads up")], icon: { type: "emoji", emoji: "💡" } }, [para(rt("Details"))]);
  assert.equal(blocksToUnits([callout], opts)[0].markdown, "Heads up\n\nDetails");
  assert.equal(blocksToUnits([callout], { calloutStyle: "callout" })[0].markdown, "> [!note] 💡\n> Heads up\n>\n> Details");
});

test("code, tables and hosted images", () => {
  const units = blocksToUnits(
    [
      block("code", { rich_text: [rt("let x = 1;")], language: "javascript" }),
      block("table", { table_width: 2, has_column_header: true }, [
        block("table_row", { cells: [[rt("A")], [rt("B")]] }),
        block("table_row", { cells: [[rt("1|2")], [rt("3")]] }),
      ]),
      block("image", { type: "file", file: { url: "https://s3.example.com/x/Pic%201.png?sig=1" }, caption: [] }),
    ],
    opts,
  );
  assert.equal(units[0].markdown, "```javascript\nlet x = 1;\n```");
  assert.equal(units[1].markdown, "| A | B |\n| --- | --- |\n| 1\\|2 | 3 |");
  assert.equal(units[2].assets.length, 1);
  assert.equal(units[2].assets[0].fileName, "Pic 1.png");
  assert.equal(units[2].markdown, units[2].assets[0].snippet);
});

test("sections and heading shifts", () => {
  const units = blocksToUnits(
    [
      block("heading_1", { rich_text: [rt("A")] }),
      para(rt("a")),
      block("heading_2", { rich_text: [rt("A.1")] }),
      para(rt("a1")),
      block("heading_1", { rich_text: [rt("B")] }),
    ],
    opts,
  );
  assert.deepEqual(sectionRange(units, 0), [0, 1, 2, 3]);
  assert.deepEqual(sectionRange(units, 2), [2, 3]);
  assert.deepEqual(sectionRange(units, 1), [1]);
  assert.equal(shiftHeading("# A", 2), "### A");
  assert.equal(shiftHeading("plain # text", 2), "plain # text");
});
