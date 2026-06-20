// 例 .msxb をリポジトリから読み込み、変換がエラーなしで通ることを保証する回帰テスト。
// 世代別の組み込み命令を増やすたびにここへカバレッジ例を足していく。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");

const compileExample = (file: string) => {
  const src = readFileSync(join(examplesDir, file), "utf8");
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  const diagnostics = [...ld, ...pd, ...r.diagnostics];
  return { diagnostics, msx: renderMsx(r.code).replace(/\r/g, "") };
};

const errorsOf = (file: string) =>
  compileExample(file).diagnostics.filter((d) => d.severity === "error");

test("例: cat-sprite.msxb はエラーなしで変換される", () => {
  assert.deepEqual(errorsOf("cat-sprite.msxb"), []);
});

test("例: msx2-graphics-sound.msxb はエラーなしで変換される", () => {
  assert.deepEqual(errorsOf("msx2-graphics-sound.msxb"), []);
});

test("例: msx2-coverage.msxb はMSX2 命令を保持してエラーなしで変換される", () => {
  const { msx, diagnostics } = compileExample("msx2-coverage.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  // 主要なMSX2 av命令が原型のまま出力に残る（変数のみ改名）
  for (const re of [
    /COLOR=NEW/,
    /COLOR=\(1,0,0,2\)/,
    /LINE \(0,0\)-\(255,211\),1,BF/,
    /COLOR SPRITE\(0\)=15/,
    /SET PAGE 1,1/,
    /COPY \(0,0\)-\(255,211\),1 TO \(0,0\),0/,
    /=POINT\(10,10\)/,
    /PLAY\(0\)=0/,
    /\bTIME=0\b/,
    /SOUND 7,&HBE/,
  ])
    assert.match(msx, re, `保持されるべき: ${re}`);
});
