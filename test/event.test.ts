// EVENT TIMER v1 → ON INTERVAL=n GOSUB <handler> : INTERVAL ON。
// ハンドラ本体は MAIN の END 後にラベル付き＋RETURN で配置（MAINスコープ＝変数共有）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

function compile(src: string) {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return { text: renderMsx(r.code), diags: [...pd, ...r.diagnostics] };
}
const errCodes = (src: string) => compile(src).diags.filter((d) => d.severity === "error").map((d) => d.code);

test("EVENT TIMER: ON INTERVAL=n GOSUB + INTERVAL ON、ハンドラは END 後に RETURN 付き", () => {
  const { text, diags } = compile(`GLOBAL TICK%
TICK% = 0
EVENT TIMER 60
    TICK% = TICK% + 1
END EVENT
WHILE 1
WEND`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // 設置: ON INTERVAL=60 GOSUB <行> と INTERVAL ON
  const m = text.match(/ON INTERVAL=60 GOSUB (\d+)/);
  assert.ok(m, "ON INTERVAL=60 GOSUB <行>");
  assert.match(text, /INTERVAL ON/);
  // ハンドラ: GOSUB 先の行が END より後にあり、RETURN で終わる
  const handlerLine = Number(m![1]);
  const endLine = Number(text.match(/^(\d+) END$/m)![1]);
  assert.ok(handlerLine > endLine, "ハンドラは END の後に置かれる");
  assert.match(text, new RegExp(`^${handlerLine} [A-Z]+%=[A-Z]+%\\+1$`, "m")); // TICK% 加算
  assert.match(text, /^\d+ RETURN$/m);
});

test("EVENT TIMER: ハンドラの変数は MAIN と同じ2文字名を共有", () => {
  const { text } = compile(`GLOBAL N%
N% = 5
EVENT TIMER 30
    N% = N% + 1
END EVENT
PRINT N%`);
  // MAIN の N% 初期化と PRINT、ハンドラの N% 加算が同じ名前
  const initName = text.match(/^\d+ ([A-Z]+%)=5$/m)![1];
  assert.match(text, new RegExp(`${initName}=${initName}\\+1`)); // ハンドラも同名
});

test("EVENT TIMER: エラー（2つ目 / VBLANK未対応 / 関数内）", () => {
  assert.ok(errCodes(`EVENT TIMER 10\nA%=1\nEND EVENT\nEVENT TIMER 20\nB%=1\nEND EVENT`).includes("E_EVENT_TIMER_DUP"));
  assert.deepEqual(errCodes(`EVENT VBLANK\nA%=1\nEND EVENT`), ["E_EVENT_VBLANK"]);
  assert.ok(errCodes(`FUNCTION F()\nEVENT TIMER 5\nA%=1\nEND EVENT\nEND FUNCTION\nF()`).includes("E_EVENT_NOT_TOPLEVEL"));
});
