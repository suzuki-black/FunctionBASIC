// ニーモニックコメント（機械語DATAの逆アセンブル注釈）の生成・判定・除去。
// マーカーは "'@"。通常コメント("'") と区別し、MSX-BASIC 変換時に削除する
// （構造化BASIC側でだけ見せる注釈）。トランスパイラ側も同じ正規表現で除去する。
import { disassemble } from "./z80.ts";
import type { DataBlob } from "./detect.ts";

export const MNEM_PREFIX = "'@";
// 行/コメント文字列がニーモニックコメントか（先頭の空白は許容）。
export const isMnemonicComment = (text: string): boolean => /^\s*'@/.test(text);
// ソース全体からニーモニックコメント行を除去（再注釈の冪等化に使う）。
export const stripMnemonicComments = (src: string): string =>
  src.split("\n").filter((l) => !isMnemonicComment(l)).join("\n");

const hex4 = (n: number) => "&H" + (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");

// 1ブロブ分の注釈行（'@ 始まり）を生成。symbols で BIOS 名解決。
export function buildAnnotationLines(blob: DataBlob, symbols?: ReadonlyMap<number, string>): string[] {
  const addr = blob.loadAddr ?? 0;
  const out = [`${MNEM_PREFIX} ── 機械語 @ ${hex4(addr)} (${blob.values.length} bytes) ──`];
  for (const l of disassemble(blob.values, addr, symbols)) {
    const a = (l.addr & 0xffff).toString(16).toUpperCase().padStart(4, "0");
    const b = l.bytes.map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    out.push(`${MNEM_PREFIX} ${a}  ${b.padEnd(11)} ${l.text}`);
  }
  return out;
}
