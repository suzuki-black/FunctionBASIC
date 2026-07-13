// DATASET v1（方式A: RESTORE切替・メモリ最小・逐次前提）。
// DATASET name … END DATASET / READ name INTO … / RESTORE name。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

function compile(src: string) {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return { code: r.code, text: renderMsx(r.code), diags: [...pd, ...r.diagnostics] };
}
const errCodes = (src: string) => compile(src).diags.filter((d) => d.severity === "error").map((d) => d.code);

test("DATASET: 名前付きブロック→末尾にラベル付きDATA、READはガード付きRESTORE+READ", () => {
  const { text, diags } = compile(`GLOBAL A$
DATASET FRAME_A
    DATA "..####..", ".######."
END DATASET
DATASET ENEMY_X
    DATA 10, 40, 70
END DATASET
FOR I% = 0 TO 1
    READ FRAME_A INTO A$
NEXT I%
FOR I% = 0 TO 2
    READ ENEMY_X INTO A$
NEXT I%`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // DATA は末尾に出力
  assert.match(text, /DATA "\.\.####\.\.", "\.######\."/);
  assert.match(text, /DATA 10, 40, 70/);
  // 現在ブロック初期化 + 切替ガード（別ブロックのみ RESTORE）
  assert.match(text, /^\d+ [A-Z]+%=0/m); // C%=0 相当の初期化
  assert.match(text, /IF [A-Z]+%<>1 THEN RESTORE \d+:[A-Z]+%=1/);
  assert.match(text, /IF [A-Z]+%<>2 THEN RESTORE \d+:[A-Z]+%=2/);
  // RESTORE 先はリテラル行番号（MSX制約）に解決される（@@L が残らない）
  assert.doesNotMatch(text, /@@L/);
});

test("DATASET: 関数を跨いでも逐次読みが継続（現在ブロックはグローバル1個）", () => {
  const { text } = compile(`GLOBAL P%
GLOBAL Q%
DATASET PAIRS
    DATA 1, 2, 3, 4
END DATASET
FUNCTION LOADPAIR()
    GLOBAL P%
    GLOBAL Q%
    READ PAIRS INTO P%, Q%
END FUNCTION
LOADPAIR()
LOADPAIR()`);
  // 複数ターゲットは READ a,b に
  assert.match(text, /READ [A-Z]+%,[A-Z]+%/);
  // 関数内でも同じ切替ガードを使う（呼び出しを跨いで位置が進む）
  assert.match(text, /IF [A-Z]+%<>1 THEN RESTORE \d+/);
});

test("DATASET: RESTORE name はブロック先頭へ巻き戻し、現在ブロックも設定", () => {
  const { text } = compile(`GLOBAL A$
DATASET D
    DATA "x", "y"
END DATASET
READ D INTO A$
RESTORE D
READ D INTO A$`);
  // RESTORE name → RESTORE <行>:cur=id
  assert.match(text, /RESTORE \d+:[A-Z]+%=1/);
});

test("DATASET: エラー（本体はDATAのみ / 重複名 / 未定義参照）", () => {
  assert.ok(errCodes(`DATASET X\nPRINT 1\nEND DATASET`).includes("E_DATASET_BODY"));
  assert.ok(errCodes(`DATASET X\nDATA 1\nEND DATASET\nDATASET X\nDATA 2\nEND DATASET`).includes("E_DATASET_DUP"));
  assert.ok(errCodes(`GLOBAL X%\nREAD NOPE INTO X%`).includes("E_DATASET_UNKNOWN"));
  assert.ok(errCodes(`RESTORE NOPE`).includes("E_DATASET_UNKNOWN"));
});

test("DATASET: 行対応(src) — DATA 行が元ソース行に紐づく", () => {
  // 3行目 = DATASET 本体の DATA 行。末尾出力後もその由来が保たれること（#1 行連動）。
  const { code } = compile(`DATASET D
DATA 7, 8, 9
END DATASET
GLOBAL X%
READ D INTO X%`);
  const dataLine = code.find((l) => /DATA 7, 8, 9/.test(l.text));
  assert.ok(dataLine, "DATA 行がある");
  assert.ok((dataLine!.src ?? []).includes(2), "src に構造化2行目(DATA)を含む");
});

test("DATASET: 素の READ/DATA と併存しても壊れない", () => {
  const { diags } = compile(`GLOBAL A%
GLOBAL B%
DATA 100, 200
DATASET D
    DATA 5, 6
END DATASET
READ A%
READ D INTO B%`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
});
