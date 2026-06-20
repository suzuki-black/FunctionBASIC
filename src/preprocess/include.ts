// INCLUDE 解決（プリプロセッサ）。docs/01 §1.13・docs/03 §3.3.5
// パース前に INCLUDE を再帰展開し、全ファイルを1つのソースへ統合する。
// - 同一ファイルの二重 include は1回に統合（dedup）
// - 循環 include は E_INCLUDE_CYCLE、不在は E_INCLUDE_NOT_FOUND
// 注: 実ファイルI/Oはドライバが read() を渡す（テストは仮想FSを渡せる）。
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";

export interface LineOrigin {
  file: string;
  line: number; // そのファイル内の行（1始まり）
}
export interface IncludeResult {
  source: string; // 統合済みソース
  sources: string[]; // 取り込んだ全ファイル（provenance、出現順。先頭がエントリ）
  lineMap: LineOrigin[]; // 統合ソースの行(1始まり) → 由来。lineMap[mergedLine-1]
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

  const expand = (path: string, stack: string[]): { lines: string[]; map: LineOrigin[] } => {
    if (stack.includes(path)) {
      diagnostics.push(error("E_INCLUDE_CYCLE", ORIGIN, { path }));
      return { lines: [], map: [] };
    }
    if (sources.includes(path)) return { lines: [], map: [] }; // dedup（include 1回）
    const content = read(path);
    if (content == null) {
      diagnostics.push(error("E_INCLUDE_NOT_FOUND", ORIGIN, { path }));
      return { lines: [], map: [] };
    }
    sources.push(path);
    const lines: string[] = [];
    const map: LineOrigin[] = [];
    content.split("\n").forEach((line, idx) => {
      const m = line.match(/^\s*INCLUDE\s+"([^"]+)"\s*$/i);
      if (m) {
        const child = expand(resolvePath(path, m[1]), [...stack, path]);
        lines.push(...child.lines);
        map.push(...child.map);
      } else {
        lines.push(line);
        map.push({ file: path, line: idx + 1 });
      }
    });
    return { lines, map };
  };

  const { lines, map } = expand(normalize(entryPath), []);
  return { source: lines.join("\n"), sources, lineMap: map, diagnostics };
}
