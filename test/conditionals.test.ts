// 条件コンパイル（#IF/#IFDEF）の検証。resolveIncludes 経由（INCLUDE ゲートも兼ねる）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveIncludes, type PreprocessOptions } from "../src/preprocess/include.ts";

// 仮想FS。files のキー＝パス。
const run = (files: Record<string, string>, pp?: PreprocessOptions, entry = "main") => {
  const r = resolveIncludes(entry, (p) => (p in files ? files[p] : null), pp);
  return {
    src: r.source,
    errs: r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
    warns: r.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code),
  };
};

test("#IFDEF/#ELSE: 定義済みで真枝、未定義で偽枝", () => {
  const body = "#IFDEF A\nX1\n#ELSE\nX2\n#ENDIF\n";
  const on = run({ main: "#DEFINE A\n" + body });
  assert.ok(on.src.includes("X1") && !on.src.includes("X2"), "定義済み→X1");
  const off = run({ main: body });
  assert.ok(off.src.includes("X2") && !off.src.includes("X1"), "未定義→X2");
  // 指令行はソースから消える
  assert.ok(!on.src.includes("#IFDEF") && !on.src.includes("#ENDIF"));
});

test("#IFNDEF: 未定義で真枝", () => {
  const { src } = run({ main: "#IFNDEF A\nONLY_IF_UNDEF\n#ENDIF\n" });
  assert.ok(src.includes("ONLY_IF_UNDEF"));
});

test("#IF 値比較 + #ELIF + #ELSE（>= / = / 文字列）", () => {
  const prog = (lv: string) =>
    `#DEFINE L ${lv}\n#IF L >= 3\nHARD\n#ELIF L = 2\nMID\n#ELSE\nEASY\n#ENDIF\n`;
  assert.ok(run({ main: prog("3") }).src.includes("HARD"));
  assert.ok(run({ main: prog("2") }).src.includes("MID"));
  assert.ok(run({ main: prog("1") }).src.includes("EASY"));
  // 文字列比較
  const s = run({ main: `#DEFINE M "MSX2"\n#IF M = "MSX2"\nYES\n#ENDIF\n` });
  assert.ok(s.src.includes("YES"));
});

test("DEFINED() と論理演算 AND/OR/NOT", () => {
  const { src } = run({ main: `#DEFINE A\n#IF DEFINED(A) AND NOT DEFINED(B)\nHIT\n#ENDIF\n` });
  assert.ok(src.includes("HIT"));
});

test("UI 構成（pinned）がソース #DEFINE を上書きする", () => {
  // ソースは既定 1 だが、UI で START=3 を pin → HARD になる
  const prog = "#DEFINE START 1\n#IF START >= 3\nHARD\n#ELSE\nNORMAL\n#ENDIF\n";
  const { src } = run({ main: prog }, { defines: { START: "3" } });
  assert.ok(src.includes("HARD") && !src.includes("NORMAL"), "UI の 3 が勝つ");
  // pin 無し（UI未指定）ならソースの 1 が有効
  const d = run({ main: prog });
  assert.ok(d.src.includes("NORMAL"));
});

test("未定義シンボルを値比較で使うと W_PP_UNDEFINED＋0扱い", () => {
  const { src, warns } = run({ main: "#IF FOO = 1\nX\n#ENDIF\n" });
  assert.ok(warns.includes("W_PP_UNDEFINED"));
  assert.ok(!src.includes("X"), "FOO は 0 扱い → 偽");
});

test("INCLUDE は不採用枝では展開されない", () => {
  const files = { main: `#IFDEF USE_LIB\nINCLUDE "lib"\n#ENDIF\nMAINBODY\n`, lib: "LIBBODY\n" };
  const off = run(files);
  assert.ok(!off.src.includes("LIBBODY"), "未定義→lib 取り込まない");
  const on = run(files, { defines: { USE_LIB: "1" } });
  assert.ok(on.src.includes("LIBBODY"), "定義→lib 取り込む");
});

test("ネスト: 外側が偽なら内側は全て落ちる", () => {
  const { src } = run({ main: "#IFDEF A\n#IFDEF B\nAB\n#ELSE\nAnotB\n#ENDIF\n#ENDIF\n" });
  assert.ok(!src.includes("AB") && !src.includes("AnotB"));
});

test("診断: 未閉じ #IF / 孤立 #ENDIF / #ELSE 重複", () => {
  assert.ok(run({ main: "#IF DEFINED(A)\nX\n" }).errs.includes("E_PP_UNTERMINATED"));
  assert.ok(run({ main: "#ENDIF\n" }).errs.includes("E_PP_UNMATCHED_ENDIF"));
  assert.ok(
    run({ main: "#IFDEF A\n#ELSE\n#ELSE\n#ENDIF\n" }).errs.includes("E_PP_DUP_ELSE"),
  );
});
