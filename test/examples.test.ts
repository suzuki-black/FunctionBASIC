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
  const { msx, diagnostics } = compileExample("msx2-graphics-sound.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  // ダブルバッファ: SET PAGE <表示>,<描画> のピンポン（隠しページに描いて表示を切替）
  assert.match(msx, /SET PAGE 1-[A-Z]+,[A-Z]+/); // 隠しページへ描画
  assert.match(msx, /SET PAGE ([A-Z]+),\1/); // 描いたページを表示
  // SE は空きチャンネルC へ PLAY で流す（BGM の SOUND 直叩きと衝突しない）
  assert.match(msx, /PLAY "","","V15 L32 O5 G"/);
});

test("例: msx-music-fm.msxb は CALL MUSIC / FM PLAY を保持して変換される", () => {
  const { msx, diagnostics } = compileExample("msx-music-fm.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  assert.match(msx, /CALL MUSIC/); // 拡張命令名は素通し
  assert.match(msx, /PLAY "T130 [^"]*","[^"]*","[^"]*"/); // FM の3声 PLAY
});

test("例: msx2-text-format.msxb は印字書式/型変換を保持して変換される", () => {
  const { msx, diagnostics } = compileExample("msx2-text-format.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  assert.match(msx, /PRINT USING "/); // USING 節が保持
  assert.match(msx, /CINT\(3\.7\)/);
  assert.match(msx, /CSNG\(10\)\/3/);
  assert.match(msx, /TAB\(12\)/);
  assert.match(msx, /SPC\(6\)/);
  assert.match(msx, /LINE INPUT "/); // LINE INPUT 文
});

test("例: msx2-coverage.msxb はMSX2 命令を保持してエラーなしで変換される", () => {
  const { msx, diagnostics } = compileExample("msx2-coverage.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  // 主要なMSX2 av命令が原型のまま出力に残る（変数のみ改名）
  for (const re of [
    /COLOR=NEW/,
    /COLOR=\(1,0,0,2\)/,
    /LINE \(0,0\)-\(255,211\),1,BF/,
    /SET PAGE 0,0/,
    /COPY \(0,0\)-\(255,211\),0 TO \(0,0\),1/,
    /=POINT\(10,10\)/,
    /PLAY\(0\)=0/,
    /\bTIME=0\b/,
    /SOUND 7,&HB8/,
    /PLAY "","","V15 L32 O5 E"/,
  ])
    assert.match(msx, re, `保持されるべき: ${re}`);
});
