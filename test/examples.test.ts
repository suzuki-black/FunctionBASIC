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
import { resolveIncludes } from "../src/preprocess/include.ts";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(repoDir, "examples");

// INCLUDE を解決してから変換（ライブラリ INCLUDE 例の検証用）。
const compileWithIncludes = (entryRel: string) => {
  const inc = resolveIncludes(entryRel, (p) => {
    try {
      return readFileSync(join(repoDir, p), "utf8");
    } catch {
      return null;
    }
  });
  const { tokens, diagnostics: ld } = tokenize(inc.source);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  const diagnostics = [...inc.diagnostics, ...ld, ...pd, ...r.diagnostics];
  return { diagnostics, msx: renderMsx(r.code).replace(/\r/g, "") };
};

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

test("例: event-traps.msxb は ON … GOSUB を入口行へ解決して変換される", () => {
  const { msx, diagnostics } = compileExample("event-traps.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  assert.match(msx, /ON INTERVAL=60 GOSUB \d+/);
  assert.match(msx, /ON STRIG GOSUB \d+/);
  assert.match(msx, /STRIG\(0\) ON/);
});

test("ライブラリ: msx2-lib-demo.msxb は INCLUDE 解決後にエラーなしで変換される", () => {
  const { msx, diagnostics } = compileWithIncludes("examples/msx2-lib-demo.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  assert.match(msx, /SCREEN 5,2/); // M2_INIT
  assert.match(msx, /COLOR=\(/); // M2_PAL
  assert.match(msx, /PUT SPRITE [A-Z]+,\([A-Z]+,/); // M2_SPR
  assert.match(msx, /SET PAGE 1-([A-Z]+),\1/); // M2_FRAME の正しいダブルバッファ順
});

test("例: turbo-r.msxb は _TURBO ON/OFF を保持して変換される", () => {
  const { msx, diagnostics } = compileExample("turbo-r.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  assert.match(msx, /^\d+ _TURBO ON$/m);
  assert.match(msx, /^\d+ _TURBO OFF$/m);
});

test("例: msx-music-fm.msxb は CALL MUSIC / FM PLAY を保持して変換される", () => {
  const { msx, diagnostics } = compileExample("msx-music-fm.msxb");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  assert.match(msx, /CALL MUSIC\(0,0,1,1,1\)/); // FM 初期化（引数付き）
  assert.match(msx, /CALL VOICE\(@7,@7,@7\)/); // 音色設定（@n は素通し・@7=Trumpet）
  assert.match(msx, /PLAY#2,"V15 T130 [^"]*","[^"]*","[^"]*"/); // FM は device #2 で3声、V15最大音量
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
