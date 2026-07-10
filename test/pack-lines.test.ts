// packLines（":" 連結によるサイズ削減・オプトイン）の健全性検証。
// 制御フロー不変が最重要: ラベル(ジャンプ先)を跨がない・一行IFの THEN 節を延ばさない・
// ジャンプ先が解決する・255バイト超を作らない・既定OFFでは出力不変。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const build = (src: string, packLines: boolean) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program, { packLines });
  const msx = renderMsx(r.code).replace(/\r/g, "");
  return {
    msx,
    code: r.code,
    nums: r.code.map((l) => l.lineNo),
    errs: [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "error").map((d) => d.code),
  };
};
const ascendingUnique = (nums: number[]) => nums.every((n, i) => i === 0 || n > nums[i - 1]);
const jumpTargets = (msx: string) =>
  [...msx.matchAll(/\b(?:GOSUB|GOTO|THEN)\s+(\d+)\b/g)].map((m) => Number(m[1]));

test("packLines: 既定OFF（未指定）と OFF指定で出力は同一＝オプトイン", () => {
  const src = "A% = 1\nB% = 2\nPRINT A% + B%\n";
  const { tokens } = tokenize(src);
  const { program } = parse(tokens);
  const off = renderMsx(transform(program).code);
  const explicitOff = renderMsx(transform(program, { packLines: false }).code);
  assert.equal(off, explicitOff);
});

test("packLines: 直線コードを結合して行数が減る（昇順・重複なし・エラーなし）", () => {
  let src = "";
  for (let i = 0; i < 20; i++) src += `A% = A% + ${i}\n`;
  src += "PRINT A%\n";
  const off = build(src, false);
  const on = build(src, true);
  assert.deepEqual(on.errs, []);
  assert.ok(on.code.length < off.code.length, "パッキングで行数が減る");
  assert.ok(ascendingUnique(on.nums), "行番号は厳密昇順・重複なし");
});

test("packLines: 一行IFの THEN 節の後ろに文を足さない（条件化しない）", () => {
  const src = `X% = 5
IF X% > 0 THEN
    PRINT "IN"
END IF
PRINT "OUT"
Y% = 1`;
  const { msx, errs } = build(src, true);
  assert.deepEqual(errs, []);
  const thenLine = msx.split("\n").find((l) => /THEN/.test(l))!;
  // THEN 行に IN はあるが OUT は絶対に無い（あれば PRINT "OUT" が条件付きになってしまう）
  assert.match(thenLine, /"IN"/);
  assert.doesNotMatch(thenLine, /"OUT"/);
  // PRINT "OUT" は独立した行として存在する
  assert.match(msx, /(^|\n)\d+ [^\n]*PRINT "OUT"/);
});

test("packLines: GOSUB/GOTO/THEN のジャンプ先が全て実在する（ラベルを潰さない）", () => {
  // 関数呼び出し(GOSUB)＋ループ内 BREAK/CONTINUE(GOTO)＋早期RETURN(THEN)を含む
  const src = `FUNCTION ADVANCE%(N%)
    RETURN N% + 1
END FUNCTION
T% = 0
FOR I% = 1 TO 10
    IF I% = 3 THEN
        CONTINUE
    END IF
    IF I% = 8 THEN
        BREAK
    END IF
    T% = ADVANCE%(T%)
NEXT I%
PRINT T%`;
  const { msx, nums, errs } = build(src, true);
  assert.deepEqual(errs, []);
  assert.ok(ascendingUnique(nums));
  const targets = jumpTargets(msx);
  const set = new Set(nums);
  assert.ok(targets.length > 0, "ジャンプ先が存在する");
  assert.ok(targets.every((t) => set.has(t)), "全ジャンプ先が実在の行番号");
});

test("packLines: 255バイトを超える行を作らない", () => {
  let src = "";
  for (let i = 0; i < 60; i++) src += `LONGVARNAME_${i}% = ${i} * 12345\n`;
  const { msx, errs } = build(src, true);
  assert.deepEqual(errs, []);
  for (const line of msx.split("\n")) {
    assert.ok(Buffer.byteLength(line, "latin1") <= 255, `行が255バイト以内: ${line.slice(0, 40)}…`);
  }
});
