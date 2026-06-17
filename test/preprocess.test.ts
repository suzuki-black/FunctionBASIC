import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";
import { resolveIncludes, resolvePath } from "../src/preprocess/include.ts";
import { findNonSjis } from "../src/core/sjis.ts";

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return { ...r, diagnostics: [...ld, ...pd, ...r.diagnostics] };
};

// ---- Shift-JIS ----
test("Shift-JIS可能な文字（ASCII/かな/漢字）はOK", () => {
  assert.deepEqual(findNonSjis('PRINT "こんにちは漢字ｶﾅ"'), []);
});
test("絵文字・補助面はSJIS不可として検出", () => {
  assert.ok(findNonSjis("PRINT \"\u{1F600}\"").length > 0); // 😀
});
test("変換: コメント/文字列の絵文字は E_NON_SJIS", () => {
  const { diagnostics } = compile(`PRINT "hi \u{1F389}"`);
  assert.ok(diagnostics.some((d) => d.code === "E_NON_SJIS"));
});
test("変換: 日本語コメントはエラーにならない", () => {
  const { diagnostics } = compile(`' 日本語コメント\nPRINT "ｶﾅ"`);
  assert.ok(!diagnostics.some((d) => d.code === "E_NON_SJIS"));
});

// ---- INCLUDE ----
const vfs = (files: Record<string, string>) => (p: string) => files[p] ?? null;

test("INCLUDE: 取り込み・統合", () => {
  const r = resolveIncludes(
    "main.msxb",
    vfs({
      "main.msxb": `INCLUDE "lib.msxb"\nX = ADD(1, 2)`,
      "lib.msxb": `FUNCTION ADD(A, B)\n RETURN A + B\nEND FUNCTION`,
    }),
  );
  assert.deepEqual(r.diagnostics, []);
  assert.match(r.source, /FUNCTION ADD/);
  assert.match(r.source, /X = ADD\(1, 2\)/);
  assert.deepEqual(r.sources, ["main.msxb", "lib.msxb"]);
  // 統合ソースがそのまま変換できる
  const { diagnostics } = compile(r.source);
  assert.deepEqual(diagnostics, []);
});

test("INCLUDE: 二重includeは1回に統合（dedup）", () => {
  const r = resolveIncludes(
    "m.msxb",
    vfs({
      "m.msxb": `INCLUDE "a.msxb"\nINCLUDE "a.msxb"`,
      "a.msxb": `FUNCTION F()\n RETURN 0\nEND FUNCTION`,
    }),
  );
  assert.deepEqual(r.diagnostics, []);
  assert.equal((r.source.match(/FUNCTION F/g) ?? []).length, 1);
});

test("INCLUDE: 循環は E_INCLUDE_CYCLE", () => {
  const r = resolveIncludes(
    "a.msxb",
    vfs({ "a.msxb": `INCLUDE "b.msxb"`, "b.msxb": `INCLUDE "a.msxb"` }),
  );
  assert.ok(r.diagnostics.some((d) => d.code === "E_INCLUDE_CYCLE"));
});

test("INCLUDE: 不在は E_INCLUDE_NOT_FOUND", () => {
  const r = resolveIncludes("a.msxb", vfs({ "a.msxb": `INCLUDE "nope.msxb"` }));
  assert.ok(r.diagnostics.some((d) => d.code === "E_INCLUDE_NOT_FOUND"));
});

test("INCLUDE: 相対パス解決", () => {
  assert.equal(resolvePath("lib/main.msxb", "math.msxb"), "lib/math.msxb");
  assert.equal(resolvePath("lib/main.msxb", "../top.msxb"), "top.msxb");
});
