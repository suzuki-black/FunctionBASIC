// DO … LOOP（前判定 / 後判定 / 無限）。lower-do パスで While へ desugar（後判定は一時フラグ）。
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
const errCodes = (src: string, opts = {}) =>
  compile(src, opts).diags.filter((d) => d.severity === "error").map((d) => d.code);

test("DO WHILE（前判定）: WHILE と同じ IF/GOTO ループに（ゼロコスト）", () => {
  const { text, diags } = compile(`GLOBAL I%
I% = 0
DO WHILE I% < 3
    PRINT I%
    I% = I% + 1
LOOP`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /IF \([A-Z]+%<3\)=0 THEN GOTO/); // 条件偽で脱出
  assert.match(text, /PRINT [A-Z]+%/);
  assert.doesNotMatch(text, /=0 OR/); // 前判定はフラグ(=0 OR …)を使わない（ゼロコスト）
});

test("DO UNTIL（前判定）: 条件を否定した WHILE に", () => {
  const { text, diags } = compile(`GLOBAL I%
I% = 0
DO UNTIL I% >= 3
    I% = I% + 1
LOOP`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /IF \(NOT ?\([A-Z]+%>=3\)\)=0 THEN GOTO/);
});

test("DO … LOOP（無限）: 条件無しは IF (1)=0 の無限ループ、BREAK で脱出", () => {
  const { text, diags } = compile(`GLOBAL I%
I% = 0
DO
    I% = I% + 1
    IF I% = 3 THEN
        BREAK
    END IF
LOOP`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /IF \(1\)=0 THEN GOTO/); // 無限
  // BREAK は無限ループの脱出先へ GOTO する
  assert.ok(/IF [A-Z]+%=3 THEN GOTO \d+/.test(text));
});

test("DO … LOOP WHILE（後判定）: 最低1回実行し、条件は末尾で評価（フラグ使用）", () => {
  const { text, diags } = compile(`GLOBAL I%
I% = 5
DO
    PRINT I%
    I% = I% + 1
LOOP WHILE I% < 3`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // 一時フラグで初回進入を保証（(flag=0 OR cond)）。I%=5 でも本体は1回実行される構造。
  assert.match(text, /=0 OR [A-Z]+%<3\)=0 THEN GOTO/);
  assert.match(text, /PRINT [A-Z]+%/);
});

test("DO … LOOP UNTIL（後判定）: 否定条件で末尾判定", () => {
  const { text, diags } = compile(`GLOBAL I%
I% = 0
DO
    I% = I% + 1
LOOP UNTIL I% >= 3`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /=0 OR NOT ?\([A-Z]+%>=3\)\)=0 THEN GOTO/);
});

test("後判定 + CONTINUE: CONTINUE はループ末尾（条件評価）へ戻る", () => {
  const { text } = compile(`GLOBAL I%
I% = 0
DO
    I% = I% + 1
    IF I% = 2 THEN
        CONTINUE
    END IF
    PRINT I%
LOOP WHILE I% < 4`);
  // CONTINUE → GOTO <行末ラベル>、その行が条件行(IF (…)=0 …)へ GOTO で戻ること
  const lines = text.split("\n");
  const condLineNo = (lines.find((l) => /=0 OR [A-Z]+%<4\)=0 THEN GOTO/.test(l)) || "").match(/^(\d+)/)?.[1];
  const contGoto = lines.find((l) => /IF [A-Z]+%=2 THEN GOTO (\d+)/.test(l))!.match(/GOTO (\d+)/)![1];
  const contTargetLine = lines.find((l) => l.startsWith(contGoto + " "))!;
  assert.match(contTargetLine, new RegExp(`GOTO ${condLineNo}\\b`), "CONTINUE 先は条件行へ戻る");
});

test("DO と LOOP の両方に条件 → E_DO_BOTH_COND", () => {
  assert.deepEqual(
    errCodes(`DO WHILE 1
    PRINT 1
LOOP UNTIL 0`),
    ["E_DO_BOTH_COND"],
  );
});

test("BREAK/CONTINUE は DO の内側で有効（ループ外エラーにならない）", () => {
  assert.equal(
    errCodes(`GLOBAL I%
DO
    BREAK
LOOP`).length,
    0,
  );
});

test("ネスト: DO の中に SELECT CASE / DO を書ける", () => {
  const { diags } = compile(`GLOBAL I%
GLOBAL J%
I% = 0
DO WHILE I% < 3
    SELECT CASE I%
        CASE 0
            J% = 0
            DO
                J% = J% + 1
            LOOP UNTIL J% >= 2
        CASE ELSE
            PRINT I%
    END SELECT
    I% = I% + 1
LOOP`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
});
