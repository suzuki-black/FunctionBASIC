// INCLUDE 解決（プリプロセッサ）。docs/01 §1.13・docs/03 §3.3.5
// パース前に INCLUDE を再帰展開し、全ファイルを1つのソースへ統合する。
// - 同一ファイルの二重 include は1回に統合（dedup）
// - 循環 include は E_INCLUDE_CYCLE、不在は E_INCLUDE_NOT_FOUND
// 注: 実ファイルI/Oはドライバが read() を渡す（テストは仮想FSを渡せる）。
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";

export interface IncludeResult {
  source: string; // 統合済みソース
  sources: string[]; // 取り込んだ全ファイル（provenance、出現順）
  diagnostics: Diagnostic[];
}

const ORIGIN = { line: 0, column: 0 };

// 簡易パス結合（取り込み元と同ディレクトリ基準、../ . を解決）
function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}
export function resolvePath(base: string, rel: string): string {
  if (rel.startsWith("/")) return normalize(rel);
  return normalize(dirOf(base) + rel);
}
function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return (p.startsWith("/") ? "/" : "") + out.join("/");
}

export function resolveIncludes(
  entryPath: string,
  read: (path: string) => string | null,
): IncludeResult {
  const sources: string[] = [];
  const diagnostics: Diagnostic[] = [];

  const expand = (path: string, stack: string[]): string => {
    if (stack.includes(path)) {
      diagnostics.push(error("E_INCLUDE_CYCLE", ORIGIN, `INCLUDE が循環: ${path}`));
      return "";
    }
    if (sources.includes(path)) return ""; // dedup（include 1回）
    const content = read(path);
    if (content == null) {
      diagnostics.push(error("E_INCLUDE_NOT_FOUND", ORIGIN, `INCLUDE 先が見つかりません: ${path}`));
      return "";
    }
    sources.push(path);
    const outLines: string[] = [];
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*INCLUDE\s+"([^"]+)"\s*$/i);
      if (m) outLines.push(expand(resolvePath(path, m[1]), [...stack, path]));
      else outLines.push(line);
    }
    return outLines.join("\n");
  };

  const source = expand(normalize(entryPath), []);
  return { source, sources, diagnostics };
}
