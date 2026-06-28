// コメント除去（オプトイン）の検証。ジャンプ先を壊さないことが要。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string, stripComments = false) => {
  const { tokens } = tokenize(src);
  const { program } = parse(tokens);
  const r = transform(program, { stripComments });
  return renderMsx(r.code).replace(/\r/g, "");
};

test("既定(OFF)ではコメントを残す", () => {
  assert.match(compile("' note\nPRINT 1\n"), /' note/);
});

test("ON: 飛び先でないコメント行は削除", () => {
  const msx = compile("' user note\nPRINT 1\n", true);
  assert.doesNotMatch(msx, /user note/);
  assert.doesNotMatch(msx, /=== MAIN ===/); // 区画コメントも飛び先でなければ消える
});

test("ON: 行末インラインコメントは除去（行・番号は保持）", () => {
  const msx = compile('X=1 \' trailing\nPRINT X\n', true);
  assert.doesNotMatch(msx, /trailing/);
  assert.match(msx, /^\d+ [A-Z]+=1$/m); // コード本体は残る
});

test("ON: GOSUB の飛び先（関数入口コメント）は最小化して保持", () => {
  const msx = compile('FUNCTION F()\nRETURN 1\nEND FUNCTION\nA=F()\n', true);
  // GOSUB <n> の n 行が存在し続ける
  const m = msx.match(/GOSUB (\d+)/);
  assert.ok(m, "GOSUB が生成される");
  const target = m![1];
  assert.match(msx, new RegExp(`^${target} `, "m")); // 飛び先行が存在
});

test("ON: IFスキップの飛び先がコメント行でも保持（壊れない）", () => {
  // 160 行（THEN の飛び先）が REM コメントになるケースを再現
  const src = 'IF X=1 THEN\nA=F()\nPRINT A\nEND IF\nREM here\nPRINT "Z"\n'
    + 'FUNCTION F()\nRETURN 1\nEND FUNCTION\n';
  const msx = compile(src, true);
  const m = msx.match(/THEN (\d+)/);
  assert.ok(m, "IF NOT(..) THEN <line> が生成される");
  assert.match(msx, new RegExp(`^${m![1]} `, "m")); // THEN の飛び先行が存在し続ける
});

test("ON: 文字列内の ' は誤ってコメント扱いしない", () => {
  const msx = compile(`PRINT "it's ok"\n`, true);
  assert.match(msx, /PRINT "it's ok"/);
});
