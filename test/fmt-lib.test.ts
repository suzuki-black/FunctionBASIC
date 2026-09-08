// lib/fmt.msxb（文字列整形ヘルパ FORMAT$/PADL$/PADR$）の変換検証。
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
  return {
    diagnostics: [...inc.diagnostics, ...ld, ...pd, ...r.diagnostics],
    msx: renderMsx(r.code).replace(/\r/g, ""),
  };
};

test("lib/fmt.msxb: INCLUDE して FORMAT$/PADL$/PADR$ を使う例がエラーなく変換される", () => {
  const { diagnostics, msx } = compileWithIncludes("examples/fmt-demo.msxb");
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  // ゼロ埋め/左パディングの生成イディオム（RIGHT$(STRING$(...)+...)）が出る
  assert.match(msx, /RIGHT\$\(STRING\$\(/);
  // 右パディング（LEFT$(...+STRING$(...))）も出る
  assert.match(msx, /LEFT\$\([A-Z]+\$\+STRING\$\(/);
  // STR$ の先頭空白除去ガードが FORMAT$ に含まれる
  assert.match(msx, /IF LEFT\$\([A-Z]+\$,1\)=" " THEN/);
});
