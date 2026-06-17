import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import type { Token } from "../src/lexer/token.ts";

// EOF を除いた (kind,value) の並びを取り出すヘルパ
const kv = (toks: Token[]): Array<[string, string]> =>
  toks.filter((t) => t.kind !== "EOF").map((t) => [t.kind, t.value]);

test("キーワード・識別子・大文字化（文字列とコメントは原文保持）", () => {
  const { tokens, diagnostics } = tokenize(`let msg$ = "Hello world" ' あいさつ`);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(kv(tokens), [
    ["KEYWORD", "LET"],
    ["IDENT", "MSG$"],
    ["OP", "="],
    ["STRING", "Hello world"], // 中身は小文字のまま
    ["COMMENT", "' あいさつ"],
  ]);
  // raw は原文（大文字化前）
  const ident = tokens.find((t) => t.kind === "IDENT");
  assert.equal(ident?.raw, "msg$");
});

test("REF・GLOBAL・ネストしたIF/FOR・BREAK/CONTINUE", () => {
  const src = `FUNCTION FIND_ZERO(REF IDX)
    GLOBAL A
    FOR I = 1 TO 10
        IF A(I) = 0 THEN
            BREAK
        END IF
    NEXT I
END FUNCTION`;
  const { tokens, diagnostics } = tokenize(src);
  assert.deepEqual(diagnostics, []);
  const kinds = kv(tokens).map((p) => p[1]);
  assert.ok(kinds.includes("FUNCTION"));
  assert.ok(kinds.includes("REF"));
  assert.ok(kinds.includes("GLOBAL"));
  assert.ok(kinds.includes("BREAK"));
  // 識別子 FIND_ZERO（_ を含む）が1トークン
  assert.ok(tokens.some((t) => t.kind === "IDENT" && t.value === "FIND_ZERO"));
});

test("数値: 10進・小数・16進(&H)", () => {
  const { tokens } = tokenize(`X = 12 : Y = 3.14 : Z = &HFF`);
  const nums = tokens.filter((t) => t.kind === "NUMBER").map((t) => t.value);
  assert.deepEqual(nums, ["12", "3.14", "&HFF"]);
});

test("演算子: 多文字比較・整数除算・べき乗", () => {
  const { tokens } = tokenize(`A <= B >= C <> D \\ E ^ F`);
  const ops = tokens.filter((t) => t.kind === "OP").map((t) => t.value);
  assert.deepEqual(ops, ["<=", ">=", "<>", "\\", "^"]);
});

test("REM もコメント", () => {
  const { tokens } = tokenize(`X = 1 REM この行の説明`);
  const c = tokens.find((t) => t.kind === "COMMENT");
  assert.equal(c?.value, "REM この行の説明");
});

test("未閉鎖文字列はエラー（が、トークン化は継続）", () => {
  const { tokens, diagnostics } = tokenize(`PRINT "abc`);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "E_UNTERMINATED_STRING");
  assert.ok(tokens.some((t) => t.kind === "STRING" && t.value === "abc"));
});

test("行番号・列番号の追跡", () => {
  const { tokens } = tokenize(`A\nB`);
  const b = tokens.find((t) => t.kind === "IDENT" && t.value === "B");
  assert.equal(b?.pos.line, 2);
  assert.equal(b?.pos.column, 1);
});
