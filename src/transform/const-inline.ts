// CONST（名前付き定数）のコンパイル時インライン展開プリパス。
// - 初期化式を定数畳み込みしてリテラル化し、参照箇所を全てそのリテラルに置換する
//   （MSX変数は生成しない＝速度・サイズに有利）。
// - 初期化以外の代入（= / FOR ループ変数 / INPUT・READ 等の書込み）はエラーにする。
// - 折り畳めない初期化式・型不一致・名前重複もエラーで明示する（黙って誤変換しない）。
// 名前解決より前（transform 冒頭）に呼び、AST を破壊的に書き換える。
import type { Program, Stmt, Expr, LValue } from "../ast/nodes.ts";
import { suffixOf } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";

type ConstVal = { lit: Expr; suffix: string };
type Decl = { name: string; expr: Expr; pos: { line: number; column: number }; strictExempt?: boolean };

// 値を書き換える可能性のある組み込み命令（CONST へ向けるとエラー）。
const WRITE_BUILTINS = new Set(["INPUT", "LINE INPUT", "LINEINPUT", "READ", "GET", "SWAP"]);

const numLit = (v: number): Expr => ({ type: "Num", value: v, raw: fmtNum(v) });
const strLit = (v: string): Expr => ({ type: "Str", value: v });
function fmtNum(v: number): string {
  if (!isFinite(v)) return "0";
  return Number.isInteger(v) ? String(v) : String(v);
}

// 定数式を畳み込む。env=既知の定数。畳めなければ null。
function fold(e: Expr, env: Map<string, ConstVal>): Expr | null {
  switch (e.type) {
    case "Num":
    case "Str":
      return e;
    case "Var": {
      const c = env.get(e.name);
      return c ? c.lit : null;
    }
    case "Group":
      return e.items.length === 1 ? fold(e.items[0], env) : null;
    case "Un": {
      const v = fold(e.operand, env);
      if (!v || v.type !== "Num") return null;
      if (e.op === "-") return numLit(-v.value);
      if (e.op === "+") return numLit(v.value);
      if (e.op === "NOT") return numLit(~v.value);
      return null;
    }
    case "Bin": {
      const l = fold(e.left, env);
      const r = fold(e.right, env);
      if (!l || !r) return null;
      if (l.type === "Str" && r.type === "Str" && e.op === "+") return strLit(l.value + r.value);
      if (l.type !== "Num" || r.type !== "Num") return null;
      const a = l.value, b = r.value;
      switch (e.op) {
        case "+": return numLit(a + b);
        case "-": return numLit(a - b);
        case "*": return numLit(a * b);
        case "/": return numLit(a / b);
        case "\\": return numLit(Math.trunc(a / b));
        case "MOD": return numLit(a % b);
        case "^": return numLit(a ** b);
        case "AND": return numLit(a & b);
        case "OR": return numLit(a | b);
        case "XOR": return numLit(a ^ b);
        case "EQV": return numLit(~(a ^ b));
        case "IMP": return numLit(~a | b);
        default: return null; // 比較演算子は対象外（v1）
      }
    }
    default:
      return null;
  }
}

const typeOk = (suffix: string, lit: Expr): boolean =>
  suffix === "$" ? lit.type === "Str"
    : suffix === "" ? true
      // % / ! / # は数値。% は整数値のみ（CONST N% = 1.5 は宣言時に弾く）。
      : lit.type === "Num" && (suffix !== "%" || Number.isInteger(lit.value));

// scope 内（ネスト含む）の CONST 宣言を収集。
function collectConsts(stmts: Stmt[]): Decl[] {
  const out: Decl[] = [];
  const walk = (ss: Stmt[]) => {
    for (const s of ss) {
      if (s.type === "Const") out.push({ name: s.name, expr: s.expr, pos: s.pos, strictExempt: s.strictExempt });
      else if (s.type === "If") { walk(s.then); if (s.else) walk(s.else); }
      else if (s.type === "For" || s.type === "While") walk(s.body);
    }
  };
  walk(stmts);
  return out;
}

// 宣言群を畳み込んで env を作る（依存は反復解決）。
function buildEnv(decls: Decl[], base: Map<string, ConstVal>, diags: Diagnostic[], strict: boolean): Map<string, ConstVal> {
  const env = new Map(base);
  // 重複検出
  const seen = new Set<string>();
  for (const d of decls) {
    if (seen.has(d.name)) diags.push(error("E_DUP_CONST", d.pos, { name: d.name }));
    seen.add(d.name);
  }
  const pending = [...decls];
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const d = pending[i];
      const lit = fold(d.expr, env);
      if (lit) {
        const sfx = suffixOf(d.name);
        // STRICT では CONST も型サフィックス必須（変数と一貫）。ただしコンパイラ生成の
        // 整数ラベル定数（SPRITE パターン名など）は免除。
        if (strict && sfx === "" && !d.strictExempt) diags.push(error("E_STRICT_UNTYPED", d.pos, { name: d.name }));
        if (!typeOk(sfx, lit)) diags.push(error("E_CONST_TYPE", d.pos, { name: d.name }));
        env.set(d.name, { lit, suffix: sfx });
        pending.splice(i, 1);
        progress = true;
      }
    }
  }
  for (const d of pending) diags.push(error("E_CONST_NOT_CONSTANT", d.pos, { name: d.name }));
  return env;
}

// 式中の定数参照をリテラルに置換（破壊的）。
function rw(e: Expr, env: Map<string, ConstVal>): Expr {
  switch (e.type) {
    case "Var": {
      const c = env.get(e.name);
      return c ? c.lit : e;
    }
    case "Un": e.operand = rw(e.operand, env); return e;
    case "Bin": e.left = rw(e.left, env); e.right = rw(e.right, env); return e;
    case "Group": e.items = e.items.map((x) => rw(x, env)); return e;
    case "ArrayRef": e.indices = e.indices.map((x) => rw(x, env)); return e;
    case "CallExpr": e.args = e.args.map((a) => ({ ...a, expr: rw(a.expr, env) })); return e;
    default: return e; // Num / Str
  }
}

// LValue の添字のみ書換え（対象名は書込み位置なので置換しない）。
function rwLValueIndices(lv: LValue, env: Map<string, ConstVal>): void {
  if (lv.type === "ArrayRef") lv.indices = lv.indices.map((x) => rw(x, env));
}

// 文配列を書換え（CONST 文を除去・式中の定数参照を置換・代入をチェック）。
function rewriteStmts(stmts: Stmt[], env: Map<string, ConstVal>, diags: Diagnostic[]): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    switch (s.type) {
      case "Const":
        continue; // 出力しない（コンパイル時のみ）
      case "Let":
        if (env.has(s.target.name)) diags.push(error("E_CONST_ASSIGN", s.pos, { name: s.target.name }));
        rwLValueIndices(s.target, env);
        s.expr = rw(s.expr, env);
        break;
      case "For":
        if (env.has(s.varName)) diags.push(error("E_CONST_ASSIGN", s.pos, { name: s.varName }));
        s.from = rw(s.from, env);
        s.to = rw(s.to, env);
        if (s.step) s.step = rw(s.step, env);
        s.body = rewriteStmts(s.body, env, diags);
        break;
      case "While":
        s.cond = rw(s.cond, env);
        s.body = rewriteStmts(s.body, env, diags);
        break;
      case "If":
        s.cond = rw(s.cond, env);
        s.then = rewriteStmts(s.then, env, diags);
        if (s.else) s.else = rewriteStmts(s.else, env, diags);
        break;
      case "Return":
        if (s.expr) s.expr = rw(s.expr, env);
        break;
      case "Call":
        s.call.args = s.call.args.map((a) => ({ ...a, expr: rw(a.expr, env) }));
        break;
      case "Dim":
        for (const d of s.decls) d.dims = d.dims.map((x) => rw(x, env));
        break;
      case "On":
        if (s.arg) s.arg = rw(s.arg, env);
        break;
      case "Builtin": {
        const upper = s.name.toUpperCase();
        if (WRITE_BUILTINS.has(upper)) {
          for (const p of s.parts) {
            if (p.kind === "expr" && p.expr.type === "Var" && env.has(p.expr.name))
              diags.push(error("E_CONST_ASSIGN", s.pos, { name: p.expr.name }));
          }
        }
        for (const p of s.parts) if (p.kind === "expr") p.expr = rw(p.expr, env);
        break;
      }
      default:
        break;
    }
    out.push(s);
  }
  return out;
}

// CONST を畳み込み・インライン展開し、AST を書き換える。診断（エラー）を返す。
export function inlineConsts(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const empty = new Map<string, ConstVal>();
  const strict = program.strict === true;
  // 1) トップレベル＝グローバル定数
  const globalEnv = buildEnv(collectConsts(program.toplevel), empty, diags, strict);
  program.toplevel = rewriteStmts(program.toplevel, globalEnv, diags);
  // 2) 各関数＝グローバル＋関数ローカル定数（ローカルが優先）
  for (const fn of program.functions) {
    const env = buildEnv(collectConsts(fn.body), globalEnv, diags, strict);
    fn.body = rewriteStmts(fn.body, env, diags);
  }
  return diags;
}
