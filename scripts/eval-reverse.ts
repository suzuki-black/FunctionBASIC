// 逆変換（素のMSX-BASIC→構造化）の精度評価ハーネス。
// 使い方: node --experimental-strip-types scripts/eval-reverse.ts [dir=corpus]
// dir 内の .bas/.asc/.txt を readBasic→renameVars→decompile し、構造化結果を
// 順変換(tokenize→parse→transform)で「再コンパイル」して指標を出す＝ラウンドトリップ計測。
//   ① 再コンパイル成功（エラー0か）
//   ② 未対応フォールバック行（' [未対応]）の割合
//   ③ 逆変換時の警告数
// ※ corpus/ は .gitignore 済み（第三者コードはリポジトリに入れない）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBasic } from "../src/reverse/basic-reader.ts";
import { renameVars } from "../src/reverse/rename-vars.ts";
import { decompile } from "../src/reverse/decompile.ts";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const dir = process.argv[2] ?? "corpus";
let files: string[];
try {
  files = readdirSync(dir).filter((f) => /\.(bas|asc|txt)$/i.test(f)).sort();
} catch {
  console.error(`ディレクトリ ${dir}/ がありません。実 MSX-BASIC(.bas) を置いてください（corpus/ は git 管理外）。`);
  process.exit(1);
}
if (!files.length) { console.error(`${dir}/ に .bas/.asc/.txt がありません。`); process.exit(1); }

// 1ファイルを逆変換→再コンパイルし、指標を返す。
function evalFile(src: string) {
  const read = readBasic(src);
  const dec = decompile(renameVars(read.lines).lines);
  const outLines = dec.source.split("\n");
  const fallback = outLines.filter((l) => /'\s*\[未対応\]/.test(l)).length;
  const { tokens, diagnostics: ld } = tokenize(dec.source);
  const { program, diagnostics: pd } = parse(tokens);
  let errs = [...ld, ...pd].filter((d) => d.severity === "error").length;
  try {
    errs += transform(program).diagnostics.filter((d) => d.severity === "error").length;
  } catch {
    errs += 1;
  }
  return { basicLines: read.lines.length, outLines: outLines.length, fallback, warn: dec.diagnostics.length, errs };
}

let tFiles = 0, tOK = 0, tLines = 0, tFallback = 0, tWarn = 0;
console.log("file\tBASIC\t出力\t未対応\t警告\t再コンパイル");
for (const f of files) {
  const m = evalFile(readFileSync(join(dir, f), "utf8"));
  tFiles++; tLines += m.outLines; tFallback += m.fallback; tWarn += m.warn;
  if (m.errs === 0) tOK++;
  console.log(`${f}\t${m.basicLines}\t${m.outLines}\t${m.fallback}\t${m.warn}\t${m.errs === 0 ? "OK" : "NG(" + m.errs + ")"}`);
}
const pct = (100 * tFallback / Math.max(1, tLines)).toFixed(1);
console.log("---");
console.log(`files=${tFiles}  再コンパイルOK=${tOK}/${tFiles}  未対応行=${tFallback}/${tLines} (${pct}%)  警告計=${tWarn}`);
