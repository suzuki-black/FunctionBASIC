// 素のMSX-BASIC（行番号付きASCIIテキスト＝LIST出力）を読み、行番号＋文に分解する。
// マップ不要の「素のBASIC→構造化」(ミニデコンパイラ) の入力段。
// 文の区切りは ":"。ただし文字列 "..."・REM/' コメント内の ":" は区切らない
// （REM/' は行末までを1文として扱う。DATA の ":" は MSX 同様に文を終端する）。
import type { Diagnostic } from "../core/diagnostics.ts";
import { BUILTIN_STATEMENTS, BUILTIN_FUNCTIONS, BUILTIN_CLAUSE_WORDS } from "../core/builtins.ts";
import { KEYWORDS } from "../lexer/keywords.ts";
import { findNonSjis } from "../core/sjis.ts";

// 空白なしMSX-BASIC（FORI=0TO32 / IFNOTSTRIG(0)THEN3ELSECLS 等）の再トークン化用予約語。
// MSX流: トークン先頭で予約語が一致すれば後続が英字でもそれを採用（FORI→FOR I, FORMULA→FOR MULA）。
// 先頭で一致しなければ英数字の連なりを丸ごと変数として読む（SCORE は分割しない）。長い順に判定。
const RESERVED: string[] = [
  ...KEYWORDS, ...BUILTIN_STATEMENTS, ...BUILTIN_FUNCTIONS, ...BUILTIN_CLAUSE_WORDS,
  "GOTO", "GOSUB", "DEF", "FN", "DEFINT", "DEFSNG", "DEFDBL", "DEFSTR",
].filter((w, i, a) => a.indexOf(w) === i).sort((a, b) => b.length - a.length);

const isAlpha = (c: string) => /[A-Za-z]/.test(c);
const isAlnum = (c: string) => /[A-Za-z0-9]/.test(c);
const isDig = (c: string) => c >= "0" && c <= "9";

// 1文を MSX 流に再トークン化して必要な空白を補う（既存の空白は保持＝冪等）。
// コメント('/REM)・DATA はそのまま（再トークン化しない）。
function respace(stmt: string): string {
  if (stmt.startsWith("'") || /^REM\b/i.test(stmt)) return stmt;
  const dm = stmt.match(/^DATA([\s\S]*)$/i); // DATA は内容を式解釈せず、命令名だけ分離
  if (dm) return "DATA" + (dm[1] === "" || dm[1].startsWith(" ") ? dm[1] : " " + dm[1]);

  const s = stmt;
  const n = s.length;
  let out = "";
  let prevWord = false; // 直前が語(キーワード/識別子/数値/文字列)か
  let i = 0;
  const emit = (tok: string, word: boolean) => {
    if (word && prevWord) out += " "; // 語と語が密着するなら空白を挿入
    out += tok;
    prevWord = word;
  };
  while (i < n) {
    const c = s[i];
    if (c === " " || c === "\t") { out += c; prevWord = false; i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== '"') j++;
      if (j < n) j++;
      emit(s.slice(i, j), true);
      i = j;
      continue;
    }
    if (c === "'") { out += (prevWord ? " " : "") + s.slice(i); break; } // 行内コメント
    if (isAlpha(c)) {
      let kw = "";
      for (const W of RESERVED) {
        if (i + W.length <= n && s.slice(i, i + W.length).toUpperCase() === W) { kw = s.slice(i, i + W.length); break; }
      }
      if (kw) { emit(kw, true); i += kw.length; continue; }
      let j = i + 1; // 予約語でなければ英数字の連なり＋型サフィックスを変数として読む
      while (j < n && isAlnum(s[j])) j++;
      if (j < n && /[%!#$]/.test(s[j])) j++;
      emit(s.slice(i, j), true);
      i = j;
      continue;
    }
    if (isDig(c) || (c === "." && isDig(s[i + 1] ?? "")) || c === "&") {
      let j = i;
      if (c === "&") {
        j++;
        if (j < n && /[HOB]/i.test(s[j])) { j++; while (j < n && /[0-9A-Fa-f]/.test(s[j])) j++; }
      } else {
        while (j < n && isDig(s[j])) j++;
        if (s[j] === ".") { j++; while (j < n && isDig(s[j])) j++; }
        if (/[ED]/i.test(s[j] ?? "") && /[0-9+\-]/.test(s[j + 1] ?? "")) {
          j++; if (s[j] === "+" || s[j] === "-") j++; while (j < n && isDig(s[j])) j++;
        }
      }
      if (j < n && /[%!#$]/.test(s[j])) j++;
      emit(s.slice(i, j), true);
      i = j;
      continue;
    }
    out += c; prevWord = false; i++; // 演算子・記号
  }
  return out;
}

// Shift-JIS で表現できない文字（実ファイルのUTF-8コメント等）を '?' へ置換し E_NON_SJIS を回避。
function sanitizeSjis(src: string): string {
  const bad = new Set(findNonSjis(src));
  if (!bad.size) return src;
  return [...src].map((c) => (bad.has(c) ? "?" : c)).join("");
}

export interface BasicLine {
  lineNo: number;
  stmts: string[]; // この行の文（: で分割済み・trim済み・空は除去）
}
export interface ReadResult {
  lines: BasicLine[];
  diagnostics: Diagnostic[];
}

// 1行の本文を文へ分割（文字列/REM/' を保護）。
export function splitStatements(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      cur += c;
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; cur += c; continue; }
    // ' / REM コメントは行末まで。直前の文と分離して別文（コメント）にする
    // （例: GOSUB 660 ' note → ["GOSUB 660", "' note"]）。
    if (c === "'") { out.push(cur); out.push(body.slice(i)); cur = ""; break; }
    if ((c === "R" || c === "r") && /^REM\b/i.test(body.slice(i))) {
      out.push(cur); out.push(body.slice(i)); cur = "";
      break;
    }
    if (c === ":") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  // IF 文は THEN/ELSE 分岐が行末まで続く（その : は分岐内の区切り）。
  // 先頭が IF の文以降は結合して1文に戻す。
  const fi = out.findIndex((s) => /^\s*IF\b/i.test(s));
  const merged = fi >= 0 ? [...out.slice(0, fi), out.slice(fi).join(":")] : out;
  return merged.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function readBasic(src: string): ReadResult {
  const lines: BasicLine[] = [];
  const diagnostics: Diagnostic[] = [];
  const rows = sanitizeSjis(src).split(/\r?\n/); // 非SJIS文字を '?' へ（実ファイルのUTF-8コメント対策）
  for (let r = 0; r < rows.length; r++) {
    const raw = rows[r];
    if (!raw.trim()) continue; // 空行
    const m = raw.match(/^\s*(\d+)\s?(.*)$/);
    if (!m) {
      diagnostics.push({
        code: "W_BASIC_NO_LINENO",
        key: "",
        params: {},
        message: `行番号がありません（スキップ）: ${raw.trim().slice(0, 40)}`,
        line: r + 1,
        column: 1,
        severity: "warning",
      });
      continue;
    }
    lines.push({ lineNo: parseInt(m[1], 10), stmts: splitStatements(m[2]).map(respace) });
  }
  return { lines, diagnostics };
}
