// 回帰: 1行IF化(tryOneLineIf)が THEN 本体のコメントを ":" で挟んで詰めてしまう問題。
// MSX-BASIC では ":'コメント" 以降が全部コメント扱いになり後続の文が消える(＝黙って壊れる)。
// さらに長い日本語コメントだとパック行が255バイト超で E_LINE_TOO_LONG になる。
// 修正: THEN 本体にコメントがあれば1行化せずブロック形式にし、コメントを独立行へ出す。
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

test("文の間の長いコメントを含むネストIFが E_LINE_TOO_LONG にならず全行255以内", () => {
  const long =
    "これは文の間に置かれたそこそこ長い日本語のコメントで、1行IF化で : 連結されるとパックされた物理行が255バイトを超えてしまう可能性があるためテストしている説明文である";
  const src = [
    "GLOBAL A%",
    "A% = 0",
    "IF A% = 0 THEN",
    "    IF A% = 0 THEN",
    "        A% = 1",
    `        ' ${long}`,
    "        A% = 2",
    "    END IF",
    "END IF",
  ].join("\n");
  const { msx, errs } = compile(src);
  assert.equal(errs.length, 0, "E_LINE_TOO_LONG が出ない");
  for (const l of msx.split("\n"))
    assert.ok(Buffer.byteLength(l, "utf8") <= 255, `255超の行: ${l.slice(0, 40)}...`);
});

test("コメントの後ろの文が消えない(':'で飲み込まれずライブな文として残る)", () => {
  // 短いコメントなら行長は問題にならないが、1行IF化すると ":'c: POKE..." となり POKE が
  // コメント扱いで消える。修正後はブロック形式=POKE が独立行(行頭が POKE)に出る。
  const src = [
    "IF 1 = 1 THEN",
    "    POKE 0, 111",
    "    ' short note",
    "    POKE 0, 222",
    "END IF",
  ].join("\n");
  const { msx, errs } = compile(src);
  assert.equal(errs.length, 0);
  // コメントの「後ろ」の文(POKE 0,222)が、行頭に来るライブ文として残っている
  assert.ok(/^\d+ POKE 0, ?222\b/m.test(msx), "コメント後の POKE 0,222 がライブ行として残る");
  // コメントより「前」の文も当然残る
  assert.ok(/POKE 0, ?111\b/.test(msx), "コメント前の POKE 0,111 も残る");
  // どのコード行でも POKE 0,222 が同一行の "'" より後ろに置かれていない(=飲み込まれていない)
  for (const l of msx.split("\n")) {
    const q = l.indexOf("'");
    const p = l.indexOf("POKE 0,222");
    const p2 = l.indexOf("POKE 0, 222");
    const pp = p >= 0 ? p : p2;
    if (pp >= 0 && q >= 0) assert.ok(pp < q, `POKE がコメントに飲み込まれている: ${l}`);
  }
});
