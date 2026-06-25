// 素のBASIC→構造化(その2): 明示的に構造が分かる部分を復元する。
// 行番号除去・多文行の展開・FOR/NEXT・WHILE/WEND の入れ子(インデント)・REM/'→コメント・
// 単行 IF…THEN[…ELSE…] のブロック化。THEN/ELSE 先が行番号/GOTO のものは #15 領域として素通し。
// GOTO/GOSUB 等の制御は #15 で扱うため、ここでは素通しする。
import type { BasicLine } from "./basic-reader.ts";
import type { Diagnostic } from "../core/diagnostics.ts";

export interface RestructureResult {
  source: string;
  diagnostics: Diagnostic[];
}

const UNIT = "    ";

// 文字列/REM/' を保護して top-level の : で分割（IF 分岐内の展開用）。
function splitColonSafe(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { cur += c; if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === "'") { cur += s.slice(i); break; }
    if ((c === "R" || c === "r") && /^REM\b/i.test(s.slice(i))) { cur += s.slice(i); break; }
    if (c === ":") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

// 文字列外の top-level ELSE の位置（無ければ -1）。
function findElse(s: string): number {
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (/[A-Za-z]/.test(c) && /^ELSE\b/i.test(s.slice(i)) && (i === 0 || !/[A-Za-z0-9_]/.test(s[i - 1]))) {
      return i;
    }
  }
  return -1;
}

// REM/' を構造化コメント '... へ。
function toComment(s: string): string {
  if (s.startsWith("'")) return s;
  const m = s.match(/^REM\b\s?(.*)$/i);
  return m ? (m[1] ? "' " + m[1] : "'") : s;
}

export function restructure(lines: BasicLine[]): RestructureResult {
  const out: string[] = [];
  const diagnostics: Diagnostic[] = [];
  let depth = 0;
  const push = (text: string) => out.push(UNIT.repeat(Math.max(0, depth)) + text);
  const warn = (msg: string) =>
    diagnostics.push({ code: "W_REVERSE_STRUCT", key: "", params: {}, message: msg, line: 0, column: 0, severity: "warning" });
  const isLineNo = (s: string) => /^\d+$/.test(s.trim());
  const isJump = (b: string) => b === "" || isLineNo(b) || /^GOTO\b/i.test(b) || /^GOSUB\b/i.test(b);

  const emit = (stmtRaw: string): void => {
    const stmt = stmtRaw.trim();
    if (!stmt) return;

    if (stmt.startsWith("'") || /^REM\b/i.test(stmt)) { push(toComment(stmt)); return; }

    if (/^FOR\b/i.test(stmt)) { push(stmt); depth++; return; }
    if (/^NEXT\b/i.test(stmt)) {
      const vars = stmt.replace(/^NEXT\b/i, "").trim();
      const count = vars ? vars.split(",").length : 1; // NEXT I,J は2段閉じる
      for (let k = 0; k < count; k++) {
        depth--;
        if (depth < 0) { depth = 0; warn("NEXT に対応する FOR がありません"); }
        push("NEXT");
      }
      return;
    }
    if (/^WHILE\b/i.test(stmt)) { push(stmt); depth++; return; }
    if (/^WEND\b/i.test(stmt)) {
      depth--;
      if (depth < 0) { depth = 0; warn("WEND に対応する WHILE がありません"); }
      push("WEND");
      return;
    }

    // 単行 IF…THEN[…ELSE…]
    const ifm = stmt.match(/^IF\s+([\s\S]+?)\s+THEN\b([\s\S]*)$/i);
    if (ifm) {
      const cond = ifm[1].trim();
      const after = ifm[2].trim();
      const ei = findElse(after);
      const thenPart = (ei >= 0 ? after.slice(0, ei) : after).trim();
      const elsePart = ei >= 0 ? after.slice(ei + 4).trim() : "";
      // THEN/ELSE が行番号/GOTO 主体 → #15 領域。丸ごと素通し。
      if (isJump(thenPart) || (ei >= 0 && isJump(elsePart))) { push(stmt); return; }
      push(`IF ${cond} THEN`);
      depth++;
      for (const s of splitColonSafe(thenPart)) emit(s);
      depth--;
      if (ei >= 0) {
        push("ELSE");
        depth++;
        for (const s of splitColonSafe(elsePart)) emit(s);
        depth--;
      }
      push("END IF");
      return;
    }

    // 代入/PRINT/GOTO/GOSUB/RETURN/END/… は素通し（GOTO系は #15 で構造化）
    push(stmt);
  };

  for (const ln of lines) for (const s of ln.stmts) emit(s);
  if (depth !== 0) warn(`ブロックが閉じていません（残り深さ ${depth}）`);
  return { source: out.join("\n"), diagnostics };
}
