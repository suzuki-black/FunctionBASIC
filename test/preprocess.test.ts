import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";
import { renderMsx } from "../src/transform/transformer.ts";
import { reverse } from "../src/reverse/reverse.ts";
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
test("外字は字句解析でソース位置つきに検出される（3行目のコメント）", () => {
  const { diagnostics } = compile(`X=1\nY=2\n' delta ±1`);
  const d = diagnostics.find((x) => x.code === "E_NON_SJIS");
  assert.ok(d, "E_NON_SJIS が出る");
  assert.equal(d.line, 3, `該当ソース行(3)を指す: ${d.line}`);
  assert.match(String(d.params?.chars ?? ""), /±/);
});
test("DATA 文字列内の外字も検出される", () => {
  const { diagnostics } = compile(`DATA "café"`);
  assert.ok(diagnostics.some((x) => x.code === "E_NON_SJIS"));
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

test("INCLUDE provenance → 逆変換でファイル分割復元＋往復一致", () => {
  const files: Record<string, string> = {
    "main.msxb": `INCLUDE "math.msxb"\nGTOTAL = 0\nGTOTAL = DOUBLE(21)\nPRINT GTOTAL`,
    "math.msxb": `FUNCTION DOUBLE(N)\n    RETURN N * 2\nEND FUNCTION`,
  };
  const fwd = (fs: Record<string, string>) => {
    const inc = resolveIncludes("main.msxb", (p) => fs[p] ?? null);
    assert.deepEqual(inc.diagnostics, []);
    const { tokens } = tokenize(inc.source);
    const { program } = parse(tokens);
    const r = transform(program, {
      lineMap: inc.lineMap,
      sources: inc.sources,
      source: "main.msxb",
    });
    return r;
  };
  const r1 = fwd(files);
  assert.deepEqual(r1.diagnostics, []);
  // 関数 DOUBLE の由来が math.msxb
  assert.equal(r1.map.functions.find((f) => f.name === "DOUBLE")?.sourceFile, "math.msxb");

  // 逆変換でファイル分割
  const rev = reverse(r1.code, r1.map);
  const paths = rev.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["main.msxb", "math.msxb"]);
  const main = rev.files.find((f) => f.path === "main.msxb")!;
  const math = rev.files.find((f) => f.path === "math.msxb")!;
  assert.match(main.source, /INCLUDE "math.msxb"/);
  assert.match(math.source, /FUNCTION DOUBLE\(N\)/);
  assert.ok(!/FUNCTION/.test(main.source), "関数はmainに出ない（math側へ分割）");

  // 復元したファイル群を再度 include→変換 → MSX が一致
  const fs2: Record<string, string> = {};
  for (const f of rev.files) fs2[f.path] = f.source;
  const r2 = fwd(fs2);
  assert.equal(renderMsx(r1.code), renderMsx(r2.code), "往復でMSX一致");
});
