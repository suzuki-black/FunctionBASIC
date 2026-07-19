// ELSEIF：IF … ELSEIF cond THEN … ELSE … END IF。パース時に入れ子 IF へ desugar し、
// 既存の IF lowering に載る（AST/変換/出力に専用処理を足さない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

function compile(src: string, opts = {}) {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program, opts);
  return { code: r.code, text: renderMsx(r.code), diags: [...pd, ...r.diagnostics] };
}
const errors = (src: string, opts = {}) =>
  compile(src, opts).diags.filter((d) => d.severity === "error");

test("ELSEIF: 多段分岐が先勝ち・フォールスルーせず IF 連鎖に変換される", () => {
  const { text, diags } = compile(`GLOBAL N%
N% = 3
IF N% = 1 THEN
    PRINT "ONE"
ELSEIF N% = 2 THEN
    PRINT "TWO"
ELSEIF N% = 3 THEN
    PRINT "THREE"
ELSE
    PRINT "OTHER"
END IF`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // 3本の条件分岐 + ELSE 本体
  assert.match(text, /PRINT "ONE"/);
  assert.match(text, /PRINT "TWO"/);
  assert.match(text, /PRINT "THREE"/);
  assert.match(text, /PRINT "OTHER"/);
  // 各 then 本体の後に共通の合流点へ GOTO で抜ける（素通りしない）
  assert.ok(/PRINT "ONE"[\s\S]*?GOTO/.test(text), "最初の本体後に GOTO で抜ける");
  assert.ok(/PRINT "THREE"[\s\S]*?GOTO/.test(text), "途中の本体後にも GOTO で抜ける");
});

test("ELSEIF: 末尾 ELSE 無しでも成立（どれにも合致しなければ何もしない）", () => {
  const { text, diags } = compile(`GLOBAL N%
N% = 9
IF N% = 1 THEN
    PRINT "ONE"
ELSEIF N% = 2 THEN
    PRINT "TWO"
END IF
PRINT "DONE"`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /PRINT "ONE"/);
  assert.match(text, /PRINT "TWO"/);
  assert.match(text, /PRINT "DONE"/);
});

test("ELSEIF: 単一 ELSEIF（IF/ELSEIF/END IF）", () => {
  const { diags } = compile(`GLOBAL X%
X% = 5
IF X% < 0 THEN
    PRINT "NEG"
ELSEIF X% > 0 THEN
    PRINT "POS"
END IF`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
});

test("ELSEIF: 各分岐は元の ELSEIF 行に由来（provenance/行対応）", () => {
  const { code } = compile(`GLOBAL N%
IF N% = 1 THEN
    PRINT "A"
ELSEIF N% = 2 THEN
    PRINT "B"
END IF`);
  // 出力行に元ソース行(src)が付く。src は数値 or "4,5" のようなカンマ結合文字列。
  const srcNums = new Set<number>();
  for (const l of code) {
    if (l.src == null) continue;
    for (const n of String(l.src).split(",")) srcNums.add(Number(n));
  }
  // 少なくとも IF 行(2) と ELSEIF 行(4) の双方が由来として現れる
  assert.ok(srcNums.has(2), "IF 行が由来に含まれる");
  assert.ok(srcNums.has(4), "ELSEIF 行が由来に含まれる");
});

test("ELSEIF: 条件は評価順（先に合致した分岐だけが実行される形）", () => {
  // N%=2 のとき TWO のみ。ONE/THREE の本体は前段のガードでスキップされる構造。
  const { text } = compile(`GLOBAL N%
N% = 2
IF N% = 1 THEN
    PRINT "ONE"
ELSEIF N% = 2 THEN
    PRINT "TWO"
ELSEIF N% = 2 THEN
    PRINT "TWO-DUP"
END IF`);
  // 最初の N%=2 に合致 → その後の重複分岐へは合流点 GOTO で飛ぶので TWO-DUP は実行されない構造
  assert.ok(/PRINT "TWO"[\s\S]*?GOTO/.test(text), "合致本体の後に合流 GOTO");
});

test("1行IF: THEN の後に文が続くと E_IF_SINGLE_LINE を IF の位置で（カスケードしない）", () => {
  // 初心者が MSX-BASIC 風に 1行IF を書いたケース。エラーは IF の行に1件だけ出て、
  // 後続の WEND 等へ波及しない（従来は WEND で複数エラーになり原因が伝わらなかった）。
  const errs = errors(`GLOBAL X%
X% = 0
WHILE 1
    X% = X% - 2
    IF X% < -16 THEN X% = 255
    PRINT X%
WEND`);
  assert.equal(errs.length, 1, "エラーは1件だけ");
  assert.equal(errs[0].code, "E_IF_SINGLE_LINE");
  assert.equal(errs[0].line, 5, "エラーは1行IFの行（WENDではない）");
});

test("1行IF: ブロックIFに直せば通る", () => {
  assert.equal(
    errors(`GLOBAL X%
X% = 0
IF X% < -16 THEN
    X% = 255
END IF`).length,
    0,
  );
});

test("1行IF: ELSEIF の1行形も検出", () => {
  const errs = errors(`GLOBAL N%
IF N% = 1 THEN
    PRINT "A"
ELSEIF N% = 2 THEN PRINT "B"
END IF`);
  assert.ok(errs.some((d) => d.code === "E_IF_SINGLE_LINE"), "ELSEIF の1行形も E_IF_SINGLE_LINE");
});

test("ELSEIF: ネストした通常 IF と併存しても壊れない", () => {
  const { diags } = compile(`GLOBAL A%
GLOBAL B%
IF A% = 1 THEN
    IF B% = 1 THEN
        PRINT "11"
    END IF
ELSEIF A% = 2 THEN
    PRINT "2"
END IF`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
});
