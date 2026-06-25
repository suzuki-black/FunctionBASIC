// 素のBASIC→構造化(その3・本丸): GOSUB/IF/GOTO を構造へ。
// - GOSUB先(..RETURN)を FUNCTION SUB<行>() として抽出し、GOSUB n → SUB<n>() 呼び出しに。
//   関数本体が使う変数は GLOBAL 宣言（元BASICは全変数グローバルのため意味保存）。
// - IF cond THEN <前方行>（前方スキップ）→ IF NOT(cond) THEN … END IF。
// - IF cond THEN <非ジャンプ> → ブロック化（内部の GOSUB も呼び出しへ）。
// - 還元できない GOTO / ON GOTO・GOSUB / 後方GOTO は best-effort でコメント化＋警告。
import type { BasicLine } from "./basic-reader.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { restructureStmts, splitColonSafe, findElse } from "./restructure.ts";
import { isKeyword } from "../lexer/keywords.ts";
import { isBuiltin } from "../core/builtins.ts";

export interface DecompileResult {
  source: string;
  diagnostics: Diagnostic[];
}

export function decompile(lines: BasicLine[]): DecompileResult {
  const diagnostics: Diagnostic[] = [];
  const warn = (msg: string) =>
    diagnostics.push({ code: "W_REVERSE_GOTO", key: "", params: {}, message: msg, line: 0, column: 0, severity: "warning" });

  const posOf = new Map<number, number>();
  lines.forEach((l, i) => posOf.set(l.lineNo, i));
  const lastStmt = (i: number) => lines[i].stmts[lines[i].stmts.length - 1] ?? "";

  // 全ジャンプ先（GOTO/GOSUB/THEN行/ON …）
  const targets = new Set<number>();
  const gosubTargets = new Set<number>();
  for (const l of lines) {
    for (const s of l.stmts) {
      let m: RegExpMatchArray | null;
      if ((m = s.match(/\bGOSUB\s+(\d+)/i))) { gosubTargets.add(+m[1]); targets.add(+m[1]); }
      for (const g of s.matchAll(/\bGOTO\s+(\d+)/gi)) targets.add(+g[1]);
      if ((m = s.match(/^IF\s+[\s\S]+?\s+THEN\s+(\d+)/i))) targets.add(+m[1]);
      if (/^ON\b/i.test(s)) for (const g of s.matchAll(/(\d+)/g)) targets.add(+g[1]);
    }
  }

  // 関数領域（GOSUB先 .. RETURN）を抽出
  const inFunc = new Array<boolean>(lines.length).fill(false);
  const funcName = (t: number) => "SUB" + t;
  const funcNames = new Set<string>();
  const funcs: { name: string; lo: number; hi: number }[] = [];
  for (const t of [...gosubTargets].sort((a, b) => a - b)) {
    const start = posOf.get(t);
    if (start == null) { warn(`GOSUB ${t} の飛び先が見つかりません`); continue; }
    if (inFunc[start]) continue;
    let end = start;
    while (end < lines.length && !/\bRETURN\b/i.test(lastStmt(end))) end++;
    if (end >= lines.length) { warn(`GOSUB ${t} に対応する RETURN が見つかりません`); continue; }
    for (let k = start; k <= end; k++) inFunc[k] = true;
    funcs.push({ name: funcName(t), lo: start, hi: end });
    funcNames.add(funcName(t));
  }

  // 前方条件ジャンプ（IF cond THEN n / IF cond THEN GOTO n / IF cond GOTO n）
  const condJump = (stmt: string): { cond: string; target: number } | null => {
    let m = stmt.match(/^IF\s+([\s\S]+?)\s+THEN\s+(?:GOTO\s+)?(\d+)\s*$/i);
    if (m) return { cond: m[1].trim(), target: +m[2] };
    m = stmt.match(/^IF\s+([\s\S]+?)\s+GOTO\s+(\d+)\s*$/i);
    if (m) return { cond: m[1].trim(), target: +m[2] };
    return null;
  };
  // [a..b] が範囲外からジャンプされていない（途中侵入なし）か
  const noEntryInto = (a: number, b: number): boolean => {
    for (let k = a; k <= b; k++) if (targets.has(lines[k].lineNo)) return false;
    return true;
  };

  // 1文の書き換え（行レベルの前方スキップは rewriteRange 側で処理）
  const rwStmt = (stmt: string): string[] => {
    const s = stmt.trim();
    if (!s) return [];
    if (s.startsWith("'") || /^REM\b/i.test(s)) return [s];
    let m = s.match(/^GOSUB\s+(\d+)\s*$/i);
    if (m) return [funcName(+m[1]) + "()"];
    if (/^RETURN\b/i.test(s)) return ["RETURN"];
    if (/^GOTO\s+\d+\s*$/i.test(s)) { warn(`未対応の GOTO: ${s}`); return [`' [未対応] ${s}`]; }
    if (/^ON\b/i.test(s) && /\b(GOTO|GOSUB)\b/i.test(s)) {
      warn(`未対応の ON ${/GOSUB/i.test(s) ? "GOSUB" : "GOTO"}: ${s}`);
      return [`' [未対応] ${s}`];
    }
    // IF に GOTO が絡む（前方スキップにできなかった残り）→ フォールバック
    if (/^IF\b/i.test(s) && /\bGOTO\b/i.test(s)) { warn(`未対応の IF…GOTO: ${s}`); return [`' [未対応] ${s}`]; }
    const ifm = s.match(/^IF\s+([\s\S]+?)\s+THEN\b([\s\S]*)$/i);
    if (ifm) {
      const cond = ifm[1].trim();
      const after = ifm[2].trim();
      const ei = findElse(after);
      const thenP = (ei >= 0 ? after.slice(0, ei) : after).trim();
      const elseP = ei >= 0 ? after.slice(ei + 4).trim() : "";
      if (/^\d+$/.test(thenP) || (ei >= 0 && /^\d+$/.test(elseP))) { warn(`未対応の IF…THEN 行ジャンプ: ${s}`); return [`' [未対応] ${s}`]; }
      const body: string[] = [`IF ${cond} THEN`];
      for (const x of splitColonSafe(thenP)) body.push(...rwStmt(x));
      if (ei >= 0) { body.push("ELSE"); for (const x of splitColonSafe(elseP)) body.push(...rwStmt(x)); }
      body.push("END IF");
      return body;
    }
    return [s];
  };

  // 行範囲 [lo..hi] を書き換えて out へ。前方IF-skip を IF ブロックへ。
  const rewriteRange = (lo: number, hi: number, out: string[]): void => {
    let i = lo;
    while (i <= hi) {
      const stmts = lines[i].stmts;
      const cj = condJump(stmts[stmts.length - 1] ?? "");
      const tp = cj ? posOf.get(cj.target) : undefined;
      const safe = cj && tp != null && tp > i && tp <= hi && noEntryInto(i + 1, tp - 1);
      if (cj && safe) {
        for (let k = 0; k < stmts.length - 1; k++) for (const o of rwStmt(stmts[k])) out.push(o);
        out.push(`IF NOT(${cj.cond}) THEN`);
        rewriteRange(i + 1, tp! - 1, out);
        out.push("END IF");
        i = tp!;
      } else {
        for (const st of stmts) for (const o of rwStmt(st)) out.push(o);
        i++;
      }
    }
  };

  // 関数本体が使う変数（GLOBAL 宣言用）。キーワード/組み込み/関数名は除外。
  const globalVars = (body: string[]): string[] => {
    const set = new Set<string>();
    for (const s of body) {
      if (s.startsWith("'") || /^REM\b/i.test(s)) continue;
      const noStr = s.replace(/"[^"]*"/g, " ");
      for (const mm of noStr.matchAll(/[A-Za-z][A-Za-z0-9]*[%!#$]?/g)) {
        const id = mm[0].toUpperCase();
        const bare = id.replace(/[%!#$]$/, "");
        if (isKeyword(bare) || isBuiltin(id) || isBuiltin(bare)) continue;
        if (funcNames.has(bare) || funcNames.has(id)) continue;
        set.add(id);
      }
    }
    return [...set].sort();
  };

  // main（関数領域外の連続ブロック）→ 関数、の順に書き換え
  const stmts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (inFunc[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && !inFunc[j]) j++;
    rewriteRange(i, j - 1, stmts);
    i = j;
  }
  for (const f of funcs) {
    stmts.push(`FUNCTION ${f.name}()`);
    const body: string[] = [];
    rewriteRange(f.lo, f.hi, body);
    while (body.length && body[body.length - 1] === "RETURN") body.pop(); // 末尾の冗長 RETURN
    const gv = globalVars(body);
    if (gv.length) stmts.push(`GLOBAL ${gv.join(", ")}`);
    stmts.push(...body);
    stmts.push("END FUNCTION");
  }

  const r = restructureStmts(stmts);
  return { source: r.source, diagnostics: [...diagnostics, ...r.diagnostics] };
}
