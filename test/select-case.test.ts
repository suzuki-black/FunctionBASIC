// SELECT CASE v1（値 / 値リスト / CASE ELSE、セレクタ一度評価）。
// lower-select.ts で「一時Let + ネストIfBlock連鎖」へ desugar し、既存の IF lowering に載る。
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

test("SELECT CASE: 値/リスト/ELSE が正しく変換され、フォールスルーしない", () => {
  const { text, diags } = compile(`GLOBAL STATE%
STATE% = 2
SELECT CASE STATE%
    CASE 0
        PRINT "TITLE"
    CASE 1, 2, 3
        PRINT "PLAY"
    CASE ELSE
        PRINT "OTHER"
END SELECT`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // リスト CASE は OR 結合される
  assert.match(text, /=1 OR .*=2 OR .*=3/);
  // 各 CASE 本体の後に END SELECT へ抜ける GOTO があり、素通り（fall-through）しない
  assert.ok(/PRINT "TITLE"[\s\S]*GOTO/.test(text), "CASE 本体後に GOTO で抜ける");
  assert.match(text, /PRINT "OTHER"/); // CASE ELSE 本体
});

test("SELECT CASE: セレクタは一度だけ評価される（関数呼び出しセレクタ）", () => {
  const { text, diags } = compile(`FUNCTION PICK%()
    RETURN 5
END FUNCTION
SELECT CASE PICK%()
    CASE 5
        PRINT "FIVE"
    CASE 6
        PRINT "SIX"
    CASE ELSE
        PRINT "NO"
END SELECT`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // PICK% を呼ぶ GOSUB はプログラム中ちょうど1回（各 CASE で呼び直さない）
  const gosubs = (text.match(/GOSUB/g) || []).length;
  assert.equal(gosubs, 1, "セレクタ関数は1回だけ呼ぶ");
});

test("SELECT CASE: CASE 本体内の BREAK/CONTINUE は外側ループに係る", () => {
  const codes = errCodes(`FOR I% = 1 TO 5
    SELECT CASE I%
        CASE 3
            BREAK
        CASE 1
            CONTINUE
    END SELECT
    PRINT I%
NEXT I%`);
  assert.deepEqual(codes, [], "ループ内なので BREAK/CONTINUE はエラーにならない");
});

test("SELECT CASE: ループ外の CASE 内 BREAK は E_BREAK_OUTSIDE_LOOP", () => {
  const codes = errCodes(`SELECT CASE X%
    CASE 1
        BREAK
END SELECT`);
  assert.ok(codes.includes("E_BREAK_OUTSIDE_LOOP"));
});

test("SELECT CASE: CASE ELSE は最後に1つだけ（重複・位置違反はエラー）", () => {
  assert.ok(errCodes(`SELECT CASE X%
CASE ELSE
PRINT 1
CASE ELSE
PRINT 2
END SELECT`).includes("E_SELECT_ELSE_LAST"));
  assert.ok(errCodes(`SELECT CASE X%
CASE 1
PRINT 1
CASE ELSE
PRINT 9
CASE 2
PRINT 2
END SELECT`).includes("E_SELECT_ELSE_LAST"));
});

test("SELECT CASE v2: 範囲(lo TO hi) / 関係(IS <演算子>) / 混在", () => {
  const { text, diags } = compile(`GLOBAL N%
N% = 42
SELECT CASE N%
    CASE 0, 1
        PRINT "LOW"
    CASE 10 TO 19
        PRINT "TEENS"
    CASE IS >= 100
        PRINT "BIG"
    CASE 5 TO 9, IS < 0
        PRINT "MIX"
    CASE ELSE
        PRINT "MID"
END SELECT`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, />=10 AND .*<=19/); // 範囲
  assert.match(text, />=100/); // 関係
  assert.match(text, />=5 AND .*<=9 OR .*<0/); // 混在（AND優先で正しくグループ化）
});

test("SELECT CASE v2: 文字列範囲は文字列比較へ（型エラーなし）", () => {
  const { text, diags } = compile(`GLOBAL G$
G$ = "F"
SELECT CASE G$
    CASE "A" TO "M"
        PRINT "FIRST HALF"
    CASE ELSE
        PRINT "REST"
END SELECT`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, />="A" AND .*<="M"/);
});

test("SELECT CASE v2: CASE IS の後に演算子が無ければ E_SELECT_IS_OP", () => {
  assert.ok(errCodes(`SELECT CASE X%
CASE IS 5
PRINT 1
END SELECT`).includes("E_SELECT_IS_OP"));
});

test("SELECT CASE: ヘッダ/CASE 行末のインラインコメントを許容", () => {
  const codes = errCodes(`GLOBAL X%
X% = 1
SELECT CASE X%        ' selector comment
    CASE 1, 2         ' first
        PRINT "A"
    CASE ELSE         ' rest
        PRINT "B"
END SELECT`);
  assert.deepEqual(codes, []);
});

test("SELECT CASE: 行対応(src) — CASE 本体の行が MSX 行に紐づく", () => {
  // 4行目 = CASE 本体の PRINT。desugar 後もその行が由来(src)に含まれること（#1 行連動の土台）。
  const { code } = compile(`SELECT CASE X%
CASE 1
PRINT "HIT"
END SELECT`);
  const hit = code.find((l) => /PRINT "HIT"/.test(l.text));
  assert.ok(hit, "PRINT \"HIT\" の MSX 行がある");
  assert.ok((hit!.src ?? []).includes(3), "src に構造化3行目(PRINT)を含む");
});
