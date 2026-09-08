// 条件コンパイル（プリプロセッサ #IF/#IFDEF）。docs/conditional-compilation-design.md
// パース前・INCLUDE 解決と同層で、不採用枝の行をソースから除去する（採用枝のみが字句解析へ）。
// 対応指令: #DEFINE / #UNDEF / #IFDEF / #IFNDEF / #IF / #ELIF / #ELSE / #ENDIF。
// 式: DEFINED(X) / 比較(= == <> != < <= > >=) / 論理(AND OR NOT, && || !) / 括弧 / 整数・文字列 / シンボル。
// 未定義シンボルを値として使うと 0 扱い＋W_PP_UNDEFINED（#IFDEF の存在検査は警告なし）。
import type { Diagnostic } from "../core/diagnostics.ts";
import { error, warning } from "../core/diagnostics.ts";

// present = 定義済み。値は文字列（値なし #DEFINE は "1"）。
export type PPSymbols = Map<string, string>;

export interface PPFileResult {
  keep: boolean[]; // keep[i]=true → 入力行 i を採用（指令行・不採用枝は false）
  diagnostics: Diagnostic[];
}

const pos = (line: number) => ({ line, column: 1 });
const truthy = (v: number | string): boolean =>
  typeof v === "number" ? v !== 0 : v !== "" && v !== "0";

// ---- #IF 式の評価（値は number|string、真偽は 1/0 の number で表す）----
type Tok = { k: "num" | "str" | "id" | "op"; v: string };
function lexExpr(s: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  const ops = ["==", "<>", "!=", "<=", ">=", "&&", "||", "<", ">", "=", "!", "(", ")"];
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      if (j >= s.length) return null; // 未閉じ
      toks.push({ k: "str", v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(s[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      toks.push({ k: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ k: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    const op = ops.find((o) => s.startsWith(o, i));
    if (!op) return null;
    toks.push({ k: "op", v: op });
    i += op.length;
  }
  return toks;
}

// 再帰下降。失敗時は null（→ E_PP_BAD_EXPR）。symbols 未定義参照で onUndef を呼ぶ。
function evalExpr(
  src: string,
  symbols: PPSymbols,
  onUndef: (name: string) => void,
): number | string | null {
  const toks = lexExpr(src);
  if (!toks) return null;
  let p = 0;
  const peek = () => toks[p];
  const isKw = (w: string) => peek()?.k === "id" && peek()!.v.toUpperCase() === w;
  const isOp = (o: string) => peek()?.k === "op" && peek()!.v === o;
  let bad = false;

  const num = (v: number | string): number =>
    typeof v === "number" ? v : /^-?\d+$/.test(v) ? parseInt(v, 10) : NaN;

  const orExpr = (): number | string => {
    let v = andExpr();
    while (isKw("OR") || isOp("||")) { p++; const r = andExpr(); v = truthy(v) || truthy(r) ? 1 : 0; }
    return v;
  };
  const andExpr = (): number | string => {
    let v = notExpr();
    while (isKw("AND") || isOp("&&")) { p++; const r = notExpr(); v = truthy(v) && truthy(r) ? 1 : 0; }
    return v;
  };
  const notExpr = (): number | string => {
    if (isKw("NOT") || isOp("!")) { p++; return truthy(notExpr()) ? 0 : 1; }
    return cmpExpr();
  };
  const cmpExpr = (): number | string => {
    const a = primary();
    const o = peek();
    if (o?.k === "op" && ["==", "=", "<>", "!=", "<", "<=", ">", ">="].includes(o.v)) {
      p++;
      const b = primary();
      const an = num(a), bn = num(b);
      const bothNum = !Number.isNaN(an) && !Number.isNaN(bn);
      const cmp = bothNum ? Math.sign(an - bn) : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
      switch (o.v) {
        case "==": case "=": return cmp === 0 ? 1 : 0;
        case "<>": case "!=": return cmp !== 0 ? 1 : 0;
        case "<": return cmp < 0 ? 1 : 0;
        case "<=": return cmp <= 0 ? 1 : 0;
        case ">": return cmp > 0 ? 1 : 0;
        case ">=": return cmp >= 0 ? 1 : 0;
      }
    }
    return a;
  };
  const primary = (): number | string => {
    const t = peek();
    if (!t) { bad = true; return 0; }
    if (t.k === "op" && t.v === "(") {
      p++;
      const v = orExpr();
      if (!isOp(")")) { bad = true; return 0; }
      p++;
      return v;
    }
    if (t.k === "num") { p++; return parseInt(t.v, 10); }
    if (t.k === "str") { p++; return t.v; }
    if (t.k === "id") {
      if (t.v.toUpperCase() === "DEFINED") {
        p++;
        if (!isOp("(")) { bad = true; return 0; }
        p++;
        const name = peek();
        if (name?.k !== "id") { bad = true; return 0; }
        p++;
        if (!isOp(")")) { bad = true; return 0; }
        p++;
        return symbols.has(name.v) ? 1 : 0;
      }
      p++;
      if (symbols.has(t.v)) return symbols.get(t.v)!;
      onUndef(t.v);
      return 0;
    }
    bad = true;
    return 0;
  };

  const v = orExpr();
  if (bad || p !== toks.length) return null;
  return v;
}

// 1ファイル分の行にプリプロセッサを適用。symbols は共有（#DEFINE/#UNDEF で変異）。
// pinned = UI 構成で固定されたシンボル名（ソースの #DEFINE/#UNDEF は無効化＝UI 優先）。
export function ppFilterFile(lines: string[], symbols: PPSymbols, pinned: Set<string>): PPFileResult {
  const diagnostics: Diagnostic[] = [];
  const keep: boolean[] = new Array(lines.length).fill(false);
  // frame: parentActive を織り込んだ active、branch 採用済み taken、#ELSE 済み seenElse。
  type Frame = { active: boolean; taken: boolean; parent: boolean; seenElse: boolean };
  const stack: Frame[] = [];
  const curActive = () => (stack.length === 0 ? true : stack[stack.length - 1].active);
  const DIR = /^\s*#([A-Za-z]+)\b\s*(.*?)\s*$/;

  lines.forEach((line, idx) => {
    const m = line.match(DIR);
    if (!m) { keep[idx] = curActive(); return; } // 通常行：採用状態に従う
    const dir = m[1].toUpperCase();
    const arg = m[2];
    const evalCond = (expr: string): boolean => {
      const v = evalExpr(expr, symbols, (name) => diagnostics.push(warning("W_PP_UNDEFINED", pos(idx + 1), { name })));
      if (v === null) { diagnostics.push(error("E_PP_BAD_EXPR", pos(idx + 1), { expr })); return false; }
      return truthy(v);
    };
    switch (dir) {
      case "DEFINE": {
        const dm = arg.match(/^([A-Za-z_]\w*)\s*(.*)$/);
        if (!dm) { diagnostics.push(error("E_PP_BAD_DIRECTIVE", pos(idx + 1), { text: line.trim() })); break; }
        let val = dm[2];
        if (val === "") val = "1"; // 値なし＝真（"1"）
        else if (/^"[\s\S]*"$/.test(val)) val = val.slice(1, -1); // 文字列値は引用符を外して格納
        if (curActive() && !pinned.has(dm[1])) symbols.set(dm[1], val);
        break;
      }
      case "UNDEF": {
        const name = arg.match(/^([A-Za-z_]\w*)/)?.[1];
        if (!name) { diagnostics.push(error("E_PP_BAD_DIRECTIVE", pos(idx + 1), { text: line.trim() })); break; }
        if (curActive() && !pinned.has(name)) symbols.delete(name);
        break;
      }
      case "IFDEF":
      case "IFNDEF": {
        const name = arg.match(/^([A-Za-z_]\w*)/)?.[1];
        const parent = curActive();
        const has = !!name && symbols.has(name);
        const cond = parent && (dir === "IFDEF" ? has : !has);
        stack.push({ active: cond, taken: cond, parent, seenElse: false });
        break;
      }
      case "IF": {
        const parent = curActive();
        const cond = parent && evalCond(arg);
        stack.push({ active: cond, taken: cond, parent, seenElse: false });
        break;
      }
      case "ELIF": {
        const f = stack[stack.length - 1];
        if (!f) { diagnostics.push(error("E_PP_UNMATCHED_ELSE", pos(idx + 1), { what: "#ELIF" })); break; }
        if (f.seenElse) { diagnostics.push(error("E_PP_DUP_ELSE", pos(idx + 1), { what: "#ELIF" })); break; }
        const cond = f.parent && !f.taken && evalCond(arg);
        f.active = cond;
        f.taken = f.taken || cond;
        break;
      }
      case "ELSE": {
        const f = stack[stack.length - 1];
        if (!f) { diagnostics.push(error("E_PP_UNMATCHED_ELSE", pos(idx + 1), { what: "#ELSE" })); break; }
        if (f.seenElse) { diagnostics.push(error("E_PP_DUP_ELSE", pos(idx + 1), { what: "#ELSE" })); break; }
        f.seenElse = true;
        f.active = f.parent && !f.taken;
        f.taken = true;
        break;
      }
      case "ENDIF": {
        if (!stack.pop()) diagnostics.push(error("E_PP_UNMATCHED_ENDIF", pos(idx + 1), {}));
        break;
      }
      default:
        diagnostics.push(error("E_PP_BAD_DIRECTIVE", pos(idx + 1), { text: line.trim() }));
    }
    keep[idx] = false; // 指令行は常に除去
  });
  if (stack.length > 0) diagnostics.push(error("E_PP_UNTERMINATED", pos(lines.length), {}));
  return { keep, diagnostics };
}
