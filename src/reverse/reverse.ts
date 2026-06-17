// 逆変換（MSX-BASIC → 構造化BASIC）。docs/06
// MapTable を用いて変数名・関数境界・REF・GOSUB呼び出し・BREAK/CONTINUE を復元する。
// 初期実装: 当システムが生成した形（FUNCTION→GOSUB / 名前置換 / 1行IF / FOR-NEXT / WHILE-WEND）を認識して復元する。
import type { MsxLine } from "../transform/transformer.ts";
import type { MapTable, FuncEntry, VariantEntry } from "../core/maptable.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { warning } from "../core/diagnostics.ts";
import { KEYWORDS } from "../lexer/keywords.ts";
import { BUILTIN_STATEMENTS, BUILTIN_FUNCTIONS } from "../core/builtins.ts";

export interface ReverseResult {
  source: string;
  diagnostics: Diagnostic[];
}

const KEEP = new Set<string>([
  ...KEYWORDS,
  ...BUILTIN_STATEMENTS,
  ...BUILTIN_FUNCTIONS,
  "GOTO",
  "GOSUB",
  "THEN",
  "NOT",
]);

// 文字列を尊重して識別子を置換（キーワード/組み込み/keep集合は除外）
function restoreNames(
  text: string,
  scope: Map<string, string>,
  keep: Set<string>,
): string {
  return text.replace(/"[^"]*"|[A-Za-z][A-Za-z0-9_]*[%!#$]?/g, (m) => {
    if (m.startsWith('"')) return m;
    if (keep.has(m.toUpperCase())) return m;
    return scope.get(m) ?? m;
  });
}

// ":" でトップレベル分割（文字列内の : は無視）
function splitColon(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    if (ch === ":" && !inStr) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const indent = (d: number): string => "    ".repeat(d);

export function reverse(code: MsxLine[], map: MapTable): ReverseResult {
  const diagnostics: Diagnostic[] = [];
  const warn = (m: string) => diagnostics.push(warning("W_REVERSE_PARTIAL", { line: 0, column: 0 }, m));

  // 索引
  const globalRev = new Map<string, string>();
  for (const v of map.globalVarMap) globalRev.set(v.msxName, v.original);
  const funcByEntry = new Map<
    number,
    { fn: FuncEntry; variant: VariantEntry; localRev: Map<string, string>; refRev: Map<string, string> }
  >();
  for (const fn of map.functions) {
    const localRev = new Map<string, string>();
    for (const v of fn.localVarMap) localRev.set(v.msxName, v.original);
    for (const variant of fn.variants) {
      const refRev = new Map<string, string>();
      for (const r of variant.refSubst) refRev.set(r.actual, r.param);
      funcByEntry.set(variant.entryLine, { fn, variant, localRev, refRev });
    }
  }
  const retVars = new Set(map.functions.map((f) => f.retVar));
  const continueTargets = new Set(
    map.controlFlow.filter((f) => f.kind === "Continue").map((f) => f.targetLine),
  );
  const breakTargets = new Set(
    map.controlFlow.filter((f) => f.kind === "Break").map((f) => f.targetLine),
  );

  // セグメント分割: MAIN と 各 variant ブロック
  const entryLines = [...funcByEntry.keys()].sort((a, b) => a - b);
  const firstEntry = entryLines[0] ?? Infinity;
  const mainLines = code.filter((l) => l.lineNo < firstEntry);

  interface Ctx {
    scope: Map<string, string>;
    keep: Set<string>;
    retVar?: string;
  }

  // GOTO番号 → BREAK/CONTINUE
  const gotoTarget = (n: number): string | null => {
    if (continueTargets.has(n)) return "CONTINUE";
    if (breakTargets.has(n)) return "BREAK";
    return null;
  };

  // インライン文列（":"区切り、GOSUB無し）を構造化文へ
  const inlineSegs = (segs: string[], ctx: Ctx): string[] => {
    const out: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === "" ) continue;
      const g = seg.match(/^GOTO\s+(\d+)$/);
      if (g) {
        const r = gotoTarget(Number(g[1]));
        out.push(r ?? `' [REVERSE?] GOTO ${g[1]}`);
        if (!r) warn(`GOTO ${g[1]} を復元できません`);
        continue;
      }
      // retVar=expr (: RETURN) → RETURN expr
      const rv = ctx.retVar
        ? seg.match(new RegExp("^" + ctx.retVar + "=(.*)$"))
        : null;
      if (rv && segs[i + 1] === "RETURN") {
        out.push(`RETURN ${rv[1].trim()}`);
        i++;
        continue;
      }
      if (rv) {
        out.push(`RETURN ${rv[1].trim()}`);
        continue;
      }
      if (seg === "RETURN") {
        out.push("RETURN");
        continue;
      }
      out.push(seg);
    }
    return out;
  };

  // GOSUB を含む行 → 呼び出し復元
  const reconstructCall = (segs: string[], ctx: Ctx): string => {
    const gi = segs.findIndex((s) => /^GOSUB\s+\d+$/.test(s));
    const n = Number(segs[gi].match(/GOSUB\s+(\d+)/)![1]);
    const info = funcByEntry.get(n);
    if (!info) return `' [REVERSE?] GOSUB ${n}`;
    const { fn, variant, localRev } = info;
    // 値引数: GOSUB前の代入（callee param msx = expr）
    const valArgs = new Map<string, string>();
    for (let i = 0; i < gi; i++) {
      const m = segs[i].match(/^([A-Za-z][A-Za-z0-9_]*[%!#$]?)=(.*)$/);
      if (m) {
        const param = localRev.get(m[1]) ?? m[1];
        valArgs.set(param, m[2].trim());
      }
    }
    // REF引数: variant.refSubst（actual を呼び出し側スコープで復元）
    const refArg = new Map<string, string>();
    for (const r of variant.refSubst)
      refArg.set(r.param, ctx.scope.get(r.actual) ?? r.actual);
    // lhs: GOSUB後の lhs=retVar
    let lhs: string | null = null;
    const after = segs[gi + 1];
    if (after) {
      const m = after.match(/^(.*)=([A-Za-z][A-Za-z0-9_]*[%!#$]?)$/);
      if (m && m[2] === fn.retVar) lhs = m[1].trim();
    }
    const args = fn.params
      .map((p) => (p.byRef ? `REF ${refArg.get(p.name) ?? p.name}` : valArgs.get(p.name) ?? "0"))
      .join(", ");
    const call = `${fn.name}(${args})`;
    return lhs ? `${lhs} = ${call}` : call;
  };

  // 行ブロックを構造化文へ（FOR/WHILE/IF/呼び出し/インライン）
  const reconstruct = (lines: MsxLine[], ctx: Ctx): string[] => {
    const out: string[] = [];
    let depth = 0;
    for (const l of lines) {
      const t0 = l.text;
      if (/^'\s*===/.test(t0)) continue; // ヘッダコメント
      const text = restoreNames(t0, ctx.scope, ctx.keep);

      // コメント
      if (text.startsWith("'")) {
        out.push(indent(depth) + text);
        continue;
      }
      // FOR / NEXT / WHILE / WEND
      if (/^FOR\s/.test(text)) {
        out.push(indent(depth) + text);
        depth++;
        continue;
      }
      if (/^NEXT(\s|$)/.test(text)) {
        depth = Math.max(0, depth - 1);
        out.push(indent(depth) + "NEXT");
        continue;
      }
      if (/^WHILE\s/.test(text)) {
        out.push(indent(depth) + text);
        depth++;
        continue;
      }
      if (/^WEND$/.test(text)) {
        depth = Math.max(0, depth - 1);
        out.push(indent(depth) + "WEND");
        continue;
      }
      if (text === "END") continue; // MAIN末尾
      // 1行IF: IF cond THEN body
      const ifm = text.match(/^IF\s+(.*?)\s+THEN\s+(.*)$/);
      if (ifm && !/^NOT\(/.test(ifm[1])) {
        out.push(indent(depth) + `IF ${ifm[1]} THEN`);
        for (const s of inlineSegs(splitColon(ifm[2]), ctx))
          out.push(indent(depth + 1) + s);
        out.push(indent(depth) + "END IF");
        continue;
      }
      if (ifm) {
        out.push(indent(depth) + `' [REVERSE?] ${text}`);
        warn(`GOTO形式IFの復元は未対応: ${text}`);
        continue;
      }
      // 呼び出し（GOSUB含む）
      if (/\bGOSUB\s+\d+/.test(text)) {
        out.push(indent(depth) + reconstructCall(splitColon(text), ctx));
        continue;
      }
      // インライン文列
      for (const s of inlineSegs(splitColon(text), ctx))
        out.push(indent(depth) + s);
    }
    return out;
  };

  // ---- MAIN ----
  const lines: string[] = [];
  lines.push(...reconstruct(mainLines, { scope: globalRev, keep: KEEP }));

  // ---- 各関数 ----
  for (const fn of map.functions) {
    const variant = fn.variants[0];
    if (!variant) continue;
    const info = funcByEntry.get(variant.entryLine)!;
    const i = entryLines.indexOf(variant.entryLine);
    const end = entryLines[i + 1] ?? Infinity;
    const body = code.filter((l) => l.lineNo >= variant.entryLine && l.lineNo < end);

    // スコープ: グローバル → ローカル → REF(actual→param) の優先
    const scope = new Map(globalRev);
    for (const [k, v] of info.localRev) scope.set(k, v);
    for (const [k, v] of info.refRev) scope.set(k, v);
    const keep = new Set(KEEP);
    keep.add(fn.retVar);

    // 関数が参照するグローバル（GLOBAL宣言の復元）
    const usedGlobals = new Set<string>();
    for (const l of body)
      for (const m of l.text.matchAll(/[A-Za-z][A-Za-z0-9_]*[%!#$]?/g)) {
        const id = m[0];
        if (globalRev.has(id) && !info.localRev.has(id) && !info.refRev.has(id))
          usedGlobals.add(globalRev.get(id)!);
      }

    const hdr = `FUNCTION ${fn.name}${fn.retSuffix}(${fn.params
      .map((p) => (p.byRef ? "REF " : "") + p.name)
      .join(", ")})`;
    lines.push("");
    lines.push(hdr);
    for (const g of usedGlobals) lines.push(indent(1) + `GLOBAL ${g}`);
    for (const s of reconstruct(body, { scope, keep, retVar: fn.retVar }))
      lines.push(indent(1) + s);
    lines.push("END FUNCTION");
  }

  return { source: lines.join("\n"), diagnostics };
}
