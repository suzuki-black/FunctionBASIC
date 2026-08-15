// 呼ばれない FUNCTION の インライン ASM をプロローグへ出力しない（デッドコード除去）検証。
// INCLUDE ライブラリ(fast.msxb 等)の未使用関数が丸ごと HIMEM へ POKE 展開され、RAM の狭い
// MSX で ~18KB を食っていた問題(digdug 研究で発見)の回帰防止。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return {
    msx: renderMsx(r.code),
    errs: [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "error"),
  };
};

test("呼ばれない FUNCTION のインライン ASM はプロローグへ出力されない（DCE）", () => {
  // USED は呼ぶ(=ASM 123 が出る)、UNUSED は呼ばない(=ASM 94 は出ない)。
  const src = [
    "FUNCTION USED()",
    "    ASM",
    "      LD A,123",
    "    END ASM",
    "END FUNCTION",
    "FUNCTION UNUSED()",
    "    ASM",
    "      LD A,94",
    "    END ASM",
    "END FUNCTION",
    "GLOBAL X%",
    "X% = 0",
    "USED()",
  ].join("\n");
  const { msx, errs } = compile(src);
  assert.equal(errs.length, 0, "コンパイルはエラー無し");
  assert.ok(/,\s*123\b/.test(msx), "呼ばれた USED の ASM(123) はプロローグへ POKE される");
  assert.ok(!/,\s*94\b/.test(msx), "呼ばれない UNUSED の ASM(94) は出力されない（DCE）");
});

test("両方呼べば両方の ASM が出る（DCE が使う関数を落とさない確認）", () => {
  const src = [
    "FUNCTION USED()",
    "    ASM",
    "      LD A,123",
    "    END ASM",
    "END FUNCTION",
    "FUNCTION ALSO()",
    "    ASM",
    "      LD A,94",
    "    END ASM",
    "END FUNCTION",
    "GLOBAL X%",
    "X% = 0",
    "USED()",
    "ALSO()",
  ].join("\n");
  const { msx, errs } = compile(src);
  assert.equal(errs.length, 0);
  assert.ok(/,\s*123\b/.test(msx) && /,\s*94\b/.test(msx), "呼ばれた関数の ASM は両方出る");
});
