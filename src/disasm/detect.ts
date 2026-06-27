// 機械語DATAの特定（best-effort）。
// 生バイト列の中身からは当てず、「使われ方」で判定する：
//   DATA → (FOR内で) READ V → POKE base+I, V   …連続メモリへ書く＝バイナリブロブ
//   ＋ USR/USRn 呼び出し or USRベクタ(F7F8..F80B)へのPOKE          …実行痕跡＝機械語
// DEFUSR は本言語では未対応のため、実行痕跡は USR 呼び出し/ベクタPOKE を主シグナルとする。
import type { Program, Stmt, Expr } from "../ast/nodes.ts";
import type { Position } from "../core/position.ts";

export interface DataBlob {
  values: number[]; // DATA から取り出したバイト列
  loadAddr: number | null; // POKE 先の基底（静的に分かれば）
  executed: boolean; // USR 呼び出し/ベクタPOKE 等の実行痕跡
  kind: "machine-code" | "binary"; // executed ? 機械語 : 不明バイナリ
  pos: Position; // ローダ(FOR)の位置
}

const USR_VEC_LO = 0xf7f8; // USR0..USR9 ベクタ（2バイト×10）
const USR_VEC_HI = 0xf80b;

// 定数式評価（変数は env で与えられた値のみ。未知なら null）。
export function evalConst(e: Expr, env: Record<string, number> = {}): number | null {
  switch (e.type) {
    case "Num":
      return e.value;
    case "Var":
      return e.name in env ? env[e.name] : null;
    case "Group":
      return e.items.length === 1 ? evalConst(e.items[0], env) : null;
    case "Un": {
      const v = evalConst(e.operand, env);
      if (v == null) return null;
      return e.op === "-" ? -v : e.op === "+" ? v : e.op === "NOT" ? ~v : null;
    }
    case "Bin": {
      const l = evalConst(e.left, env);
      const r = evalConst(e.right, env);
      if (l == null || r == null) return null;
      switch (e.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return l / r;
        case "\\": return Math.trunc(l / r);
        case "MOD": return l % r;
        case "^": return l ** r;
        case "AND": return l & r;
        case "OR": return l | r;
        case "XOR": return l ^ r;
        default: return null;
      }
    }
    default:
      return null;
  }
}

// 文を再帰的に巡回（ネストしたブロック・関数本体も含む）。
function walkStmts(program: Program, fn: (s: Stmt) => void): void {
  const rec = (stmts: Stmt[]) => {
    for (const s of stmts) {
      fn(s);
      switch (s.type) {
        case "If": rec(s.then); if (s.else) rec(s.else); break;
        case "For": rec(s.body); break;
        case "While": rec(s.body); break;
      }
    }
  };
  rec(program.toplevel);
  for (const f of program.functions) rec(f.body);
}

const exprParts = (s: any): Expr[] =>
  s.parts.filter((p: any) => p.kind === "expr").map((p: any) => p.expr);

// DATA 文（生テキストの word 1個）をカンマ分割（引用内は保護）。
const splitDataItems = (w: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const c of w) {
    if (c === '"') q = !q;
    if (c === "," && !q) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
};
// DATA 項を数値化（&H/&O/&B/10進）。文字列等は null。
const parseDataNum = (it: string): number | null => {
  const t = it.trim();
  if (/^&H[0-9A-F]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^&O[0-7]+$/i.test(t)) return parseInt(t.slice(2), 8);
  if (/^&B[01]+$/i.test(t)) return parseInt(t.slice(2), 2);
  if (/^[+-]?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
};

// DATA プールを出力行順（toplevel → 関数）で収集。非定数は null。
export function collectData(program: Program): Array<number | null> {
  const out: Array<number | null> = [];
  const grab = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.type === "Builtin" && s.name.toUpperCase() === "DATA") {
        const word = (s.parts.find((p: any) => p.kind === "word") as any)?.word ?? "";
        for (const it of splitDataItems(word)) out.push(parseDataNum(it));
      }
      switch (s.type) {
        case "If": grab(s.then); if (s.else) grab(s.else); break;
        case "For": grab(s.body); break;
        case "While": grab(s.body); break;
      }
    }
  };
  grab(program.toplevel);
  for (const f of program.functions) grab(f.body);
  return out;
}

// プログラム全体に機械語の「実行痕跡」があるか。
function hasExecutionEvidence(program: Program): boolean {
  let found = false;
  const scanExpr = (e: Expr): void => {
    if (found) return;
    if (e.type === "CallExpr") {
      if (/^USR\d?$/.test(e.name.toUpperCase())) found = true;
      e.args.forEach((a) => scanExpr(a.expr));
    } else if (e.type === "Bin") { scanExpr(e.left); scanExpr(e.right); }
    else if (e.type === "Un") scanExpr(e.operand);
    else if (e.type === "Group") e.items.forEach(scanExpr);
    else if (e.type === "ArrayRef") e.indices.forEach(scanExpr);
  };
  walkStmts(program, (s) => {
    if (s.type === "Let") { scanExpr(s.expr); }
    if (s.type === "Return" && s.expr) scanExpr(s.expr);
    if (s.type === "Call") scanExpr(s.call);
    if (s.type === "Builtin") {
      // USRベクタ(F7F8..F80B)への POKE も実行痕跡
      if (s.name.toUpperCase() === "POKE") {
        const a = evalConst(exprParts(s)[0]);
        if (a != null && a >= USR_VEC_LO && a <= USR_VEC_HI) found = true;
      }
      for (const e of exprParts(s)) scanExpr(e);
    }
  });
  return found;
}

// READ V → POKE base+I,V の FOR ローダを検出し、ブロブを返す（best-effort）。
export function findDataBlobs(program: Program): DataBlob[] {
  const data = collectData(program);
  const executed = hasExecutionEvidence(program);
  const blobs: DataBlob[] = [];
  let cursor = 0; // 複数ローダが順に DATA を消費する想定

  const scan = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.type === "For") {
        const loader = analyzeLoader(s);
        if (loader) {
          const vals = data.slice(cursor, cursor + (loader.count ?? data.length - cursor));
          cursor += vals.length;
          const clean = vals.filter((v): v is number => v != null);
          blobs.push({
            values: clean,
            loadAddr: loader.loadAddr,
            executed,
            kind: executed ? "machine-code" : "binary",
            pos: s.pos,
          });
        }
        scan(s.body);
      } else if (s.type === "If") { scan(s.then); if (s.else) scan(s.else); }
      else if (s.type === "While") scan(s.body);
    }
  };
  scan(program.toplevel);
  for (const f of program.functions) scan(f.body);
  return blobs;
}

// FOR が「READ V → POKE addr(I),V」ローダなら count と loadAddr を返す。
function analyzeLoader(forStmt: any): { count: number | null; loadAddr: number | null } | null {
  let readVar: string | null = null;
  let pokeAddr: Expr | null = null;
  let pokeOk = false;
  for (const s of forStmt.body) {
    if (s.type === "Builtin" && s.name.toUpperCase() === "READ") {
      const e = exprParts(s)[0];
      if (e && e.type === "Var") readVar = e.name;
    }
    if (s.type === "Builtin" && s.name.toUpperCase() === "POKE") {
      const ps = exprParts(s);
      pokeAddr = ps[0] ?? null;
      const val = ps[1];
      if (val && val.type === "Var" && readVar && val.name === readVar) pokeOk = true;
    }
  }
  if (!readVar || !pokeOk || !pokeAddr) return null;
  const from = evalConst(forStmt.from);
  const to = evalConst(forStmt.to);
  const count = from != null && to != null ? to - from + 1 : null;
  // ロードアドレス = ループ先頭(I=from)での POKE アドレス
  const loadAddr = from != null ? evalConst(pokeAddr, { [forStmt.varName]: from }) : null;
  return { count, loadAddr };
}
