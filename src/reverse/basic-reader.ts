// 素のMSX-BASIC（行番号付きASCIIテキスト＝LIST出力）を読み、行番号＋文に分解する。
// マップ不要の「素のBASIC→構造化」(ミニデコンパイラ) の入力段。
// 文の区切りは ":"。ただし文字列 "..."・REM/' コメント内の ":" は区切らない
// （REM/' は行末までを1文として扱う。DATA の ":" は MSX 同様に文を終端する）。
import type { Diagnostic } from "../core/diagnostics.ts";

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
    if (c === "'") { cur += body.slice(i); break; } // ' コメントは行末まで
    if ((c === "R" || c === "r") && /^REM\b/i.test(body.slice(i))) {
      cur += body.slice(i); // REM コメントは行末まで
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
    lines.push({ lineNo: parseInt(m[1], 10), stmts: splitStatements(m[2]) });
  }
  return { lines, diagnostics };
}
