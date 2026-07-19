// 整形（formatSource）が docs/13「スタイルガイド」§13.2（R1–R5）に従うことを検証する。
// formatSource はそのリファレンス実装（src/format/format.ts）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSource } from "../src/format/format.ts";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const msx = (src: string) => {
  const { tokens } = tokenize(src);
  const { program } = parse(tokens);
  return renderMsx(transform(program, {}).code);
};

test("R1 大文字化: 予約語・識別子・STRUCT/フィールド・数値を大文字化、文字列/コメントは保持", () => {
  const out = formatSource(`struct column\n  ground%, obstacle%\nend struct\ndim col(3) as column\ncol(0).ground = &hff\nprint "Keep This"   ' Keep This Too`);
  assert.match(out, /STRUCT COLUMN/);
  assert.match(out, /GROUND%, OBSTACLE%/);
  assert.match(out, /DIM COL\(3\) AS COLUMN/);
  assert.match(out, /COL\(0\)\.GROUND = &HFF/); // 識別子・フィールド・16進とも大文字
  assert.match(out, /PRINT "Keep This"/);        // 文字列の中身は保持
  assert.match(out, /' Keep This Too/);          // コメントの中身は保持
});

test("R2 インデント: 4スペース・ブロック規則（IF/FOR/WHILE/SELECT CASE/STRUCT）", () => {
  const out = formatSource(`while 1\nx = 1\nif x = 1 then\ny = 2\nelse\ny = 3\nend if\nfor i = 0 to 2\nprint i\nnext i\nselect case x\ncase 0\nprint "a"\ncase else\nprint "b"\nend select\nwend`);
  const lines = out.split("\n");
  const at = (needle: string) => lines.find((l) => l.trimStart().startsWith(needle)) || "";
  assert.ok(at("X = 1").startsWith("    X"), "WHILE 本体は 4");
  assert.ok(at("Y = 2").startsWith("        Y"), "IF 本体は 8");
  assert.ok(at("ELSE") === "    ELSE", "ELSE は 4（IF と同段）");
  assert.ok(at("PRINT I").startsWith("        PRINT"), "FOR 本体は 8");
  assert.ok(at("CASE 0").startsWith("        CASE"), "CASE は 8（SELECT 本体）");
  assert.ok(at('PRINT "a"').startsWith("            PRINT"), "CASE 本体は 12");
  assert.ok(at("END SELECT").startsWith("    END SELECT"), "END SELECT は 4");
});

test("R2 ASM: ASM…END ASM の本体は原文のまま（再インデントしない）", () => {
  const out = formatSource(`function f()\nasm\n  di\nlabel:\n  ei\nend asm\nend function`);
  const lines = out.split("\n");
  assert.ok(lines.includes("    ASM"), "ASM 行はブロック段(4)");
  assert.ok(lines.includes("  di"), "ASM 本体(2スペース)は原文のまま");
  assert.ok(lines.includes("label:"), "ASM 内ラベル(列0)は原文のまま");
  assert.ok(lines.includes("    END ASM"), "END ASM はブロック段(4)");
});

test("R4 空白: 行内の連続空白は1個へ、無空白は保持、文字列内は不変、行末空白除去", () => {
  const out = formatSource(`for     i = 1 to 20\nprint   "a    b"\nx=x-2   \nnext i`);
  const ls = out.split("\n");
  assert.ok(ls.includes("FOR I = 1 TO 20"), "FOR     I → FOR I");
  assert.ok(ls.includes('    PRINT "a    b"'), "文字列内の空白は保持");
  assert.ok(ls.includes("    X=X-2"), "無空白は保持・行末空白は除去（FOR 内なのでインデント4）");
});

test("R5 コメント: 行頭コメントは先頭空白のみ正規化・本文保持／末尾コメントは桁揃えごと不変", () => {
  const out = formatSource(`while 1\n      REM  keep   spacing\n  x = 1                 ' aligned trailing\nwend`);
  const lines = out.split("\n");
  assert.ok(lines.includes("    REM  keep   spacing"), "行頭コメントはブロック段(4)＋本文の空白は保持");
  assert.ok(lines.some((l) => l === '    X = 1                 \x27 aligned trailing'), "末尾コメントは桁揃え空白ごと不変");
});

test("整形は意味を変えない（整形前後で変換後 MSX-BASIC が同一）", () => {
  const src = `GLOBAL I%\ni%=0\nDO WHILE I%<3\nprint i%\ni%=i%+1\nLOOP`;
  assert.equal(msx(src), msx(formatSource(src)));
});

test("冪等: 整形済みを再整形しても変わらない", () => {
  const once = formatSource(`if a=1 then\nb=2\nend if`);
  assert.equal(formatSource(once), once);
});
