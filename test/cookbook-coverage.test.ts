// クックブック（examples/cookbook/*.msxb）の網羅テスト。
// (1) 各ファイルがエラーなしで変換される
// (2) 全組み込み（文・関数・節キーワード）が少なくとも1回、変換後出力に現れる
//     ＝どれかのクックブックで実際に使われ、改名されず素通しされている
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";
import {
  BUILTIN_STATEMENTS,
  BUILTIN_FUNCTIONS,
  BUILTIN_CLAUSE_WORDS,
} from "../src/core/builtins.ts";

const cookbookDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
  "cookbook",
);

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return {
    diagnostics: [...ld, ...pd, ...r.diagnostics],
    msx: renderMsx(r.code).replace(/\r/g, ""),
  };
};

// 出力からコメント行（"NNN ' …"）を除いたコード本文だけを連結。
const codeLines = (msx: string) =>
  msx
    .split("\n")
    .filter((l) => !/^\d+\s+'/.test(l))
    .join("\n");

const files = readdirSync(cookbookDir).filter((f) => f.endsWith(".msxb"));

test("クックブック: 各ファイルがエラーなしで変換される", () => {
  for (const f of files) {
    const { diagnostics } = compile(readFileSync(join(cookbookDir, f), "utf8"));
    assert.deepEqual(
      diagnostics.filter((d) => d.severity === "error"),
      [],
      `${f} は変換エラーなし`,
    );
  }
});

test("クックブック: 全組み込み（文・関数・節）が少なくとも1回使われている", () => {
  // 全クックブックのコード本文を連結
  const corpus = files
    .map((f) => codeLines(compile(readFileSync(join(cookbookDir, f), "utf8")).msx))
    .join("\n")
    .toUpperCase();

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const used = (name: string): boolean =>
    new RegExp("(?<![A-Z0-9$])" + esc(name) + "(?![A-Z0-9$])").test(corpus);

  // 対象外:
  //  LET … LET A=1 → A=1 のように消える
  //  DEFINT/DEFSNG/DEFDBL/DEFSTR … 構造化では未対応（E_DEF_UNSUPPORTED）。
  //    型は変数サフィックス % / ! / # / $ で指定する。
  const ALLOW_ABSENT = new Set([
    "LET",
    "DEFINT",
    "DEFSNG",
    "DEFDBL",
    "DEFSTR",
  ]);

  const all = [
    ...BUILTIN_STATEMENTS,
    ...BUILTIN_FUNCTIONS,
    ...BUILTIN_CLAUSE_WORDS,
  ];
  const missing = [...new Set(all)].filter(
    (n) => !ALLOW_ABSENT.has(n) && !used(n),
  );
  assert.deepEqual(missing, [], `未使用の組み込み: ${missing.join(", ")}`);
});
