// .msxb(構造化BASIC) の PLAY 文を抽出して Song へ（デコンパイル）。FunctionBASICパーサに依存する層。
// 方針: 対象 FUNCTION（--func 指定 or PLAY を含む最初の関数 or トップレベル）の直下にある PLAY 文を
// 出現順に集め、各文の ch 別(カンマ区切り)引数の「文字列リテラル」を ch ごとに連結 → playStringsToSong。
// 非リテラル(PLAY A$ 等)や入れ子内 PLAY は警告して該当分をスキップ（安全側）。
import type { Program, Stmt, Expr, BuiltinStmt, FunctionDef } from "../ast/nodes.ts";
import { playStringsToSong, type Song } from "./mml.ts";

// Str / "..."+"..." のリテラル連結のみ文字列化。非リテラルが混じれば null。
function exprToLiteral(e: Expr): string | null {
  if (e.type === "Str") return e.value;
  if (e.type === "Group" && e.items.length === 1) return exprToLiteral(e.items[0]);
  if (e.type === "Bin" && e.op === "+") {
    const l = exprToLiteral(e.left);
    const r = exprToLiteral(e.right);
    if (l == null || r == null) return null;
    return l + r;
  }
  return null;
}

// Builtin PLAY 文の ch 別引数(式)を取り出す。parts は expr / sep "," / word の列。
function playArgs(st: BuiltinStmt): Expr[] {
  const args: Expr[] = [];
  for (const p of st.parts) if (p.kind === "expr") args.push(p.expr);
  return args;
}

function collectPlays(body: Stmt[], warnings: string[]): BuiltinStmt[] {
  const out: BuiltinStmt[] = [];
  for (const s of body) {
    if (s.type === "Builtin" && s.name.toUpperCase() === "PLAY") out.push(s);
    // 入れ子ブロック内の PLAY は v1 非対応（警告のみ）
    else if (s.type === "If" || s.type === "For" || s.type === "While" || s.type === "DoLoop" || s.type === "Select") {
      const nested = findNestedPlay(s);
      if (nested) warnings.push("入れ子ブロック内の PLAY は v1 では無視されます");
    }
  }
  return out;
}
function findNestedPlay(s: any): boolean {
  const bodies: Stmt[][] = [];
  if (s.body) bodies.push(s.body);
  if (s.thenBody) bodies.push(s.thenBody);
  if (s.elseBody) bodies.push(s.elseBody);
  if (Array.isArray(s.elifs)) for (const e of s.elifs) if (e.body) bodies.push(e.body);
  for (const b of bodies) for (const st of b) if (st.type === "Builtin" && st.name?.toUpperCase() === "PLAY") return true;
  return false;
}

export interface DecompileOpts {
  func?: string; // 対象関数名（未指定なら PLAY を含む最初の関数、無ければトップレベル）
  timesig?: [number, number];
}
export function programToSong(
  program: Program,
  opts: DecompileOpts = {},
): { song: Song | null; warnings: string[] } {
  const warnings: string[] = [];
  // 対象 body を決定
  let body: Stmt[] | null = null;
  let picked = "";
  const hasPlay = (f: FunctionDef) => f.body.some((s) => s.type === "Builtin" && s.name.toUpperCase() === "PLAY");
  if (opts.func) {
    const f = program.functions.find((x) => x.name === opts.func);
    if (!f) return { song: null, warnings: [`関数が見つかりません: ${opts.func}`] };
    body = f.body;
    picked = f.name;
  } else {
    const f = program.functions.find(hasPlay);
    if (f) {
      body = f.body;
      picked = f.name;
    } else if (program.toplevel.some((s) => s.type === "Builtin" && s.name.toUpperCase() === "PLAY")) {
      body = program.toplevel;
      picked = "(toplevel)";
    }
  }
  if (!body) return { song: null, warnings: ["PLAY 文が見つかりません"] };

  const plays = collectPlays(body, warnings);
  if (!plays.length) return { song: null, warnings: [`${picked} に PLAY 文がありません`, ...warnings] };

  // ch 数 = 最大引数数。ch 別に連結
  const nch = Math.max(...plays.map((p) => playArgs(p).length));
  const chStrings: string[] = Array.from({ length: nch }, () => "");
  for (const p of plays) {
    const args = playArgs(p);
    for (let c = 0; c < nch; c++) {
      const a = args[c];
      if (!a) continue;
      const lit = exprToLiteral(a);
      if (lit == null) {
        warnings.push(`非リテラルな PLAY 引数(ch${c})をスキップ`);
        continue;
      }
      chStrings[c] += lit;
    }
  }
  const { song, warnings: w2 } = playStringsToSong(chStrings, { timesig: opts.timesig });
  return { song, warnings: [...warnings, ...w2] };
}
