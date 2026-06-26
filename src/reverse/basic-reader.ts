// 素のMSX-BASIC（行番号付きASCIIテキスト＝LIST出力）を読み、行番号＋文に分解する。
// マップ不要の「素のBASIC→構造化」(ミニデコンパイラ) の入力段。
// 文の区切りは ":"。ただし文字列 "..."・REM/' コメント内の ":" は区切らない
// （REM/' は行末までを1文として扱う。DATA の ":" は MSX 同様に文を終端する）。
import type { Diagnostic } from "../core/diagnostics.ts";
import { BUILTIN_STATEMENTS } from "../core/builtins.ts";

// MSX は命令と引数の間の空白が不要（COLOR5,1,1 / DEFINTA-Z / LOCATE9,3）。
// 先頭が命令キーワードで直後が数字/記号（DEF* は英字）なら空白を補う。長い順に判定。
const SPLIT_KW = [...BUILTIN_STATEMENTS, "GOTO", "GOSUB", "DEFINT", "DEFSNG", "DEFDBL", "DEFSTR"]
  .sort((a, b) => b.length - a.length);
function normLeadingKw(stmt: string): string {
  const up = stmt.toUpperCase();
  for (const kw of SPLIT_KW) {
    if (!up.startsWith(kw)) continue;
    const nx = stmt[kw.length];
    if (!nx) return stmt;
    // 数字が続く（COLOR5 等。記号/" は字句側で既に区切られるため対象外）
    if (/[0-9]/.test(nx)) return kw + " " + stmt.slice(kw.length);
    // DEF* は英字引数（DEFINTA-Z）
    if (/^DEF(INT|SNG|DBL|STR)$/.test(kw) && /[A-Za-z]/.test(nx)) return kw + " " + stmt.slice(kw.length);
    return stmt; // それ以外（空白・記号・英字続きの変数）はそのまま
  }
  return stmt;
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
  const rows = src.split(/\r?\n/);
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
    lines.push({ lineNo: parseInt(m[1], 10), stmts: splitStatements(m[2]).map(normLeadingKw) });
  }
  return { lines, diagnostics };
}
