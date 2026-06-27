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

  // 全ジャンプ先（GOTO/GOSUB/THEN行/ON …）。制御移行は参照元indexも記録（ループ解析用）。
  const targets = new Set<number>();
  const gosubTargets = new Set<number>();
  const refsTo = new Map<number, number[]>(); // 行番号 → それを GOTO/THEN行/ON で参照する行index群
  const addRef = (t: number, from: number) => { targets.add(t); if (!refsTo.has(t)) refsTo.set(t, []); refsTo.get(t)!.push(from); };
  const loopEnd = new Map<number, number>(); // ループ開始index → 末尾後方GOTO行index（競合は -1）
  lines.forEach((l, idx) => {
    for (const s of l.stmts) {
      let m: RegExpMatchArray | null;
      if ((m = s.match(/\bGOSUB\s+(\d+)/i))) { gosubTargets.add(+m[1]); targets.add(+m[1]); }
      for (const g of s.matchAll(/\bGOTO\s+(\d+)/gi)) addRef(+g[1], idx);
      if ((m = s.match(/^IF\s+[\s\S]+?\s+THEN\s+(\d+)/i))) addRef(+m[1], idx);
      // ON …(イベント/式) GOTO|GOSUB <行[,行…]>。GOSUB の飛び先はハンドラ関数として抽出。
      if (/^ON\b/i.test(s)) {
        const om = s.match(/\b(GOSUB|GOTO)\s+([\d,\s]+)$/i);
        if (om) for (const num of om[2].match(/\d+/g) ?? []) { addRef(+num, idx); if (/GOSUB/i.test(om[1])) gosubTargets.add(+num); }
      }
    }
    const last = (l.stmts[l.stmts.length - 1] ?? "").trim();
    const gm = last.match(/^GOTO\s+(\d+)$/i); // 末尾の無条件GOTO
    if (gm) {
      const s = posOf.get(+gm[1]);
      if (s != null && s <= idx) loopEnd.set(s, loopEnd.has(s) ? -1 : idx); // 後方（自己含む）。競合は -1
    }
  });

  // 関数領域（GOSUB先 .. RETURN）を抽出
  const inFunc = new Array<boolean>(lines.length).fill(false);
  const funcName = (t: number) => "SUB" + t;
  const funcNames = new Set<string>();
  const funcs: { name: string; lo: number; hi: number }[] = [];
  const sortedTargets = [...gosubTargets].filter((t) => posOf.has(t)).sort((a, b) => a - b);
  for (const t of [...gosubTargets]) if (!posOf.has(t)) warn(`GOSUB ${t} の飛び先が見つかりません`);
  for (const t of sortedTargets) {
    const start = posOf.get(t)!;
    if (inFunc[start]) continue;
    // 次のサブルーチン開始＝境界。条件付きRETURNでの誤検出を避けるため、
    // [start, 境界) 内で「末尾が無条件 RETURN」の最後の行を終端に。無ければ境界直前まで。
    let nextStart = lines.length;
    for (const u of sortedTargets) { const p2 = posOf.get(u)!; if (p2 > start && p2 < nextStart) nextStart = p2; }
    let end = -1;
    for (let k = start; k < nextStart; k++) if (/^RETURN\b/i.test(lastStmt(k).trim())) end = k;
    if (end < 0) end = nextStart - 1;
    for (let k = start; k <= end; k++) inFunc[k] = true;
    funcs.push({ name: funcName(t), lo: start, hi: end });
    funcNames.add(funcName(t));
  }

  // DEF FN（インライン関数）→ FUNCTION FN<名>() に巻き上げ。FN <名>( 呼び出しは FN<名>( へ。
  const defFns: { name: string; params: string; expr: string }[] = [];
  for (const l of lines) for (const s of l.stmts) {
    const m = s.match(/^DEF\s+FN\s*([A-Za-z][A-Za-z0-9]*)\s*(?:\(([^)]*)\))?\s*=\s*([\s\S]+)$/i);
    if (m) { defFns.push({ name: m[1].toUpperCase(), params: (m[2] ?? "").trim(), expr: m[3].trim() }); funcNames.add("FN" + m[1].toUpperCase()); }
  }
  // FN <名>( … ) 呼び出しを FN<名>( … ) へ（文字列内は保護）
  const convFn = (s: string): string =>
    s.replace(/"[^"]*"|(\bFN)\s+([A-Za-z][A-Za-z0-9]*)\s*\(/gi, (m, fn, name) => (fn ? `${fn}${name}(` : m));

  // 前方条件ジャンプ（IF cond THEN n / IF cond THEN GOTO n / IF cond GOTO n）。
  // 条件部に THEN/ELSE/GOTO を巻き込まないこと（双方向ジャンプ IF…THEN GOTO a ELSE GOTO b 等は対象外）。
  const noKw = (c: string) => !/\b(THEN|ELSE|GOTO)\b/i.test(c);
  const condJump = (stmt: string): { cond: string; target: number } | null => {
    let m = stmt.match(/^IF\s+([\s\S]+?)\s+THEN\s+(?:GOTO\s+)?(\d+)\s*$/i);
    if (m && noKw(m[1])) return { cond: m[1].trim(), target: +m[2] };
    // IF cond GOTO n は THEN/ELSE を含まない場合のみ
    if (!/\bTHEN\b/i.test(stmt) && !/\bELSE\b/i.test(stmt)) {
      m = stmt.match(/^IF\s+([\s\S]+?)\s+GOTO\s+(\d+)\s*$/i);
      if (m && noKw(m[1])) return { cond: m[1].trim(), target: +m[2] };
    }
    return null;
  };
  // [a..b] が範囲外からジャンプされていない（途中侵入なし）か
  const noEntryInto = (a: number, b: number): boolean => {
    for (let k = a; k <= b; k++) if (targets.has(lines[k].lineNo)) return false;
    return true;
  };

  // 1文の書き換え（行レベルの前方スキップは rewriteRange 側で処理）
  const rwStmt = (stmt: string): string[] => {
    let s = stmt.trim();
    if (!s) return [];
    if (s.startsWith("'") || /^REM\b/i.test(s)) return [s];
    // DEFINT/DEFSNG/DEFDBL/DEFSTR は構造化では型サフィックスで表現＝コメント化（意味の既定型は失われる旨を残す）
    if (/^DEF(INT|SNG|DBL|STR)\b/i.test(s)) return [`' ${s}（型既定。構造化では型サフィックスで表現）`];
    if (/^DEF\s+USR/i.test(s)) return [`' ${s}（USR定義。構造化では未対応）`]; // DEF USR[n]=addr
    if (/^DEF\s+FN\b/i.test(s)) return []; // DEF FN は FUNCTION として巻き上げ済み（ここでは除去）
    s = convFn(s); // FN <名>( → FN<名>(
    const m = s.match(/^GOSUB\s+(\d+)\s*$/i);
    if (m) return [funcName(+m[1]) + "()"];
    if (/^RETURN\b/i.test(s)) return ["RETURN"];
    if (/^GOTO\s+\d+\s*$/i.test(s)) { warn(`未対応の GOTO: ${s}`); return [`' [未対応] ${s}`]; }
    // RESTORE <行番号> は構造化に無い（引数なしRESTOREのみ）→ コメント化＋警告
    if (/^RESTORE\s+\d+/i.test(s)) { warn(`RESTORE 行番号は未対応: ${s}`); return [`' [未対応] ${s}`]; }
    if (/^ON\b/i.test(s)) {
      // ON …(SPRITE/KEY/STRIG/INTERVAL/式) GOSUB <行[,…]> → ハンドラ関数参照 SUB<行> へ
      const m2 = s.match(/^(ON\s+[\s\S]+?\s+GOSUB)\s+([\d,\s]+)$/i);
      if (m2) {
        const subs = (m2[2].match(/\d+/g) ?? []).map((n) => funcName(+n));
        return [`${m2[1].replace(/\s+/g, " ").trim()} ${subs.join(", ")}`];
      }
      if (/\bGOTO\b/i.test(s)) { warn(`未対応の ON GOTO: ${s}`); return [`' [未対応] ${s}`]; }
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
    // 最終フォールバック: 構造化に乗らない制御語（GOTO/GOSUB/THEN/孤立ELSE）が残る断片は
    // コメント化（forward で ELSE がブロックを開いたまま→FUNCTION ネスト等を防ぐ）。
    if (/\b(GOTO|GOSUB|THEN|ELSE)\b/i.test(s.replace(/"[^"]*"/g, '""'))) {
      warn(`未対応の構文: ${s}`);
      return [`' [未対応] ${s}`];
    }
    return [s];
  };

  // ループ内の脱出: GOTO <ループ直後行> は BREAK に。
  const rwStmtExit = (stmt: string, exit?: number): string[] => {
    if (exit != null) { const m = stmt.trim().match(/^GOTO\s+(\d+)\s*$/i); if (m && +m[1] === exit) return ["BREAK"]; }
    return rwStmt(stmt);
  };

  // i が後方GOTOループの開始なら情報を返す。構造化できない（外部侵入/不明脱出）場合は null。
  const loopInfo = (i: number, hi: number): { g: number; kind: "while1" | "whilenot"; cond?: string; exit?: number } | null => {
    const g = loopEnd.get(i);
    if (g == null || g < 0 || g < i || g > hi) return null;
    const exit = lines[g + 1]?.lineNo; // ループ直後の行番号（脱出先）
    for (let k = i; k <= g; k++) {
      if (k > i) for (const from of refsTo.get(lines[k].lineNo) ?? []) if (from < i || from > g) return null; // 外部から内部へ侵入
      for (const s of lines[k].stmts) {
        const outs: number[] = [];
        let m = s.match(/^IF\s+[\s\S]+?\s+THEN\s+(?:GOTO\s+)?(\d+)\s*$/i); if (m) outs.push(+m[1]);
        m = s.match(/^IF\s+[\s\S]+?\s+GOTO\s+(\d+)\s*$/i); if (m) outs.push(+m[1]);
        for (const gg of s.matchAll(/\bGOTO\s+(\d+)/gi)) outs.push(+gg[1]);
        for (const t of outs) {
          const tp = posOf.get(t);
          if (!(tp != null && tp >= i && tp <= g) && t !== exit) return null; // 範囲外かつ脱出先でない＝不明な脱出
        }
      }
    }
    const s0 = lines[i].stmts;
    if (s0.length === 1) { const cj = condJump(s0[0]); if (cj && cj.target === exit) return { g, kind: "whilenot", cond: cj.cond, exit }; }
    return { g, kind: "while1", exit };
  };

  // ループ末尾行の文（末尾の戻りGOTOは除去）を out へ。
  const emitLoopTail = (g: number, out: string[], exit?: number) => {
    const st = lines[g].stmts;
    const drop = /^GOTO\s+\d+\s*$/i.test((st[st.length - 1] ?? "").trim());
    for (let k = 0; k < (drop ? st.length - 1 : st.length); k++) for (const o of rwStmtExit(st[k], exit)) out.push(o);
  };

  // 行範囲 [lo..hi] を書き換えて out へ。後方GOTOループ→WHILE、前方IF-skip→IFブロック、脱出→BREAK。
  const rewriteRange = (lo: number, hi: number, out: string[], lex?: number): void => {
    let i = lo;
    while (i <= hi) {
      const li = loopInfo(i, hi);
      if (li) {
        if (li.kind === "whilenot") {
          out.push(`WHILE NOT(${li.cond})`);
          rewriteRange(i + 1, li.g - 1, out, li.exit);
        } else {
          out.push("WHILE 1");
          rewriteRange(i, li.g - 1, out, li.exit);
        }
        emitLoopTail(li.g, out, li.exit);
        out.push("WEND");
        i = li.g + 1;
        continue;
      }
      const stmts = lines[i].stmts;
      const cj = condJump(stmts[stmts.length - 1] ?? "");
      // 条件付き脱出 → BREAK
      if (cj && lex != null && cj.target === lex) {
        for (let k = 0; k < stmts.length - 1; k++) for (const o of rwStmtExit(stmts[k], lex)) out.push(o);
        out.push(`IF ${cj.cond} THEN`, "BREAK", "END IF");
        i++;
        continue;
      }
      const tp = cj ? posOf.get(cj.target) : undefined;
      const safe = cj && tp != null && tp > i && tp <= hi && noEntryInto(i + 1, tp - 1);
      if (cj && safe) {
        for (let k = 0; k < stmts.length - 1; k++) for (const o of rwStmtExit(stmts[k], lex)) out.push(o);
        out.push(`IF NOT(${cj.cond}) THEN`);
        rewriteRange(i + 1, tp! - 1, out, lex);
        out.push("END IF");
        i = tp!;
      } else {
        for (const st of stmts) for (const o of rwStmtExit(st, lex)) out.push(o);
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

  // ブロック(FOR/WHILE/IFブロック形)の開閉を均す: 不足クローザを末尾に補い、余剰クローザは捨てる。
  // 領域ごとに均すことで、未閉のブロックに後続の FUNCTION がネストするのを防ぐ。
  const balanceBlocks = (src: string[]): string[] => {
    const out: string[] = [];
    const stack: string[] = [];
    for (const s of src) {
      const u = s.trim().toUpperCase();
      if (/^FOR\b/.test(u)) { out.push(s); stack.push("NEXT"); }
      else if (/^WHILE\b/.test(u)) { out.push(s); stack.push("WEND"); }
      else if (/^IF\b[\s\S]*\bTHEN$/.test(u)) { out.push(s); stack.push("END IF"); }
      else if (u === "NEXT" || /^NEXT\b/.test(u)) { if (stack[stack.length - 1] === "NEXT") { stack.pop(); out.push("NEXT"); } }
      else if (u === "WEND") { if (stack[stack.length - 1] === "WEND") { stack.pop(); out.push(s); } }
      else if (u === "END IF") { if (stack[stack.length - 1] === "END IF") { stack.pop(); out.push(s); } }
      else out.push(s);
    }
    while (stack.length) out.push(stack.pop()!);
    return out;
  };

  // main（関数領域外の連続ブロック）を集める。RETURN が main に残るのは未抽出サブルーチン
  // の取りこぼし＝構造化では不正なのでコメント化（best-effort）。
  const mainRaw: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (inFunc[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && !inFunc[j]) j++;
    rewriteRange(i, j - 1, mainRaw);
    i = j;
  }
  const stmts: string[] = balanceBlocks(mainRaw.map((s) =>
    s.trim().toUpperCase() === "RETURN" ? (warn("RETURN が関数の外にあります（コメント化）"), `' [未対応] ${s.trim()}`) : s,
  ));
  for (const f of funcs) {
    const body: string[] = [];
    rewriteRange(f.lo, f.hi, body);
    while (body.length && body[body.length - 1] === "RETURN") body.pop(); // 末尾の冗長 RETURN
    const balanced = balanceBlocks(body);
    stmts.push(`FUNCTION ${f.name}()`);
    const gv = globalVars(balanced);
    if (gv.length) stmts.push(`GLOBAL ${gv.join(", ")}`);
    stmts.push(...balanced, "END FUNCTION");
  }
  // DEF FN → FUNCTION FN<名>(params) / RETURN expr / END FUNCTION（式内の FN 呼び出しも変換）
  for (const d of defFns) {
    const ret = `RETURN ${convFn(d.expr)}`;
    const params = d.params.split(",").map((x) => x.trim()).filter(Boolean);
    stmts.push(`FUNCTION FN${d.name}(${params.join(", ")})`);
    const gv = globalVars([ret]).filter((v) => !params.some((p) => p.toUpperCase() === v));
    if (gv.length) stmts.push(`GLOBAL ${gv.join(", ")}`);
    stmts.push(ret, "END FUNCTION");
  }
  // 呼ばれているのに定義が無い SUB<n>（GOSUB先が未抽出/不存在）→ 空スタブ＋警告（コンパイル可能に）。
  const called = new Set<string>();
  for (const s of stmts) for (const m of s.matchAll(/\bSUB(\d+)\b/g)) called.add("SUB" + m[1]);
  for (const name of called) {
    if (!funcNames.has(name)) {
      warn(`${name} の定義が見つかりません（空スタブを生成）`);
      stmts.push(`FUNCTION ${name}()`, "END FUNCTION");
      funcNames.add(name);
    }
  }

  const r = restructureStmts(stmts);
  return { source: r.source, diagnostics: [...diagnostics, ...r.diagnostics] };
}
