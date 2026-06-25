// ラウンドトリップ回帰: 自作の素のMSX-BASICサンプルを逆変換し、
// その構造化BASICを順変換で再コンパイルしてエラーが出ないことを保証する。
// （第三者コードは置かない＝examples/reverse-samples/*.msxbas は自作。実コーパスは corpus/ にローカルで。）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readBasic } from "../src/reverse/basic-reader.ts";
import { renameVars } from "../src/reverse/rename-vars.ts";
import { decompile } from "../src/reverse/decompile.ts";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "reverse-samples");

for (const f of readdirSync(dir).filter((x) => x.endsWith(".msxbas")).sort()) {
  test(`ラウンドトリップ: ${f} は逆変換→再コンパイルでエラーなし`, () => {
    const structured = decompile(renameVars(readBasic(readFileSync(join(dir, f), "utf8")).lines).lines).source;
    const { tokens, diagnostics: ld } = tokenize(structured);
    const { program, diagnostics: pd } = parse(tokens);
    const r = transform(program);
    const errs = [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "error");
    assert.deepEqual(errs, [], `${f} 再コンパイルエラー:\n--- 構造化BASIC ---\n${structured}\n--- 診断 ---\n${errs.map((e) => e.code + " " + e.message).join("\n")}`);
    // フォールバック（' [未対応]）が無いこと（自作サンプルは全て構造化できる想定）
    assert.equal(/'\s*\[未対応\]/.test(structured), false, `${f} に未対応フォールバックが残っている:\n${structured}`);
  });
}
