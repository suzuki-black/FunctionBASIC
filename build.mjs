// コア(src/**/*.ts)をブラウザ用ESM(dist/**/*.js)へ変換（依存ゼロ）。
// Node の型ストリップで型注釈を除去し、import 指定子の .ts → .js を書き換える。
import { stripTypeScriptTypes } from "node:module";
import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const SRC = "src";
const OUT = "editor/core"; // エディタ(フロントエンド)に同梱する形でコアをビルド

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

rmSync(OUT, { recursive: true, force: true });
const files = walk(SRC);
let count = 0;
for (const file of files) {
  const code = readFileSync(file, "utf8");
  let js = stripTypeScriptTypes(code, { mode: "strip" });
  // import/export ... from "X.ts" → "X.js"
  js = js.replace(/(\bfrom\s+["'])([^"']+)\.ts(["'])/g, "$1$2.js$3");
  const outPath = join(OUT, file.slice(SRC.length + 1)).replace(/\.ts$/, ".js");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, js);
  count++;
}
// 組み込みライブラリ（examples/lib/*.msxb）をエディタへバンドル。
// ブラウザ版は実ファイルI/Oが無いため、INCLUDE をこの埋め込み辞書で解決する。
// キーは "lib/<name>.msxb"（ファイル配置どおり）と "<name>.msxb"（basename）両対応。
const LIB_DIR = "examples/lib";
const libs = {};
try {
  for (const name of readdirSync(LIB_DIR)) {
    if (!name.endsWith(".msxb")) continue;
    const content = readFileSync(join(LIB_DIR, name), "utf8");
    libs["lib/" + name] = content;
    libs[name] = content;
  }
} catch {
  /* lib ディレクトリが無ければスキップ */
}
writeFileSync(
  join(OUT, "libs.js"),
  "// 自動生成（build.mjs）: 組み込みライブラリの埋め込み。編集しない。\n" +
    "export const LIBS = " + JSON.stringify(libs, null, 2) + ";\n",
);

console.log(`built ${count} files → ${OUT}/ (libs: ${Object.keys(libs).length / 2})`);
