// SPRITE name … END SPRITE（ドット絵パターン定義）→ MSX-BASIC への desugar パス。
// checkExplicit / inlineConsts より前に走らせる。各スプライトを:
//   1) CONST name = <パターン番号>  … 以降 name はどこで使ってもパターン番号にインライン展開
//      される（PUT SPRITE …, name のように「番号の代わりに名前」で書け、定義と使用が名前で
//      目に見えて繋がる＝SPRITE$ の罠を解消）。
//   2) SPRITE$(番号) = CHR$(…)+…      … VRAM へパターンを書き込む実行文（宣言位置に出力）。
// へ機械展開し、SpriteDef ノードを AST から取り除く（下流は SpriteDef を一切見ない）。
//
// バイト化: 8行=8×8（8バイト）／16行=16×16（32バイト）。16×16 は MSX VDP の 4象限順
// （左上→左下→右上→右下、各8バイト）へ並べ替える。ユーザは見たまま正方の格子を描く。
// MSX の1行255文字制限を越えないよう、32バイトは一時文字列変数へ分割連結してから代入する。
import type { Program, Stmt, Expr, LValue, SpriteDef, BuiltinStmt } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error, warning } from "../core/diagnostics.ts";

const ON_CHARS = new Set(["#", "*", "●", "X", "x", "1"]); // 点灯
const OFF_CHARS = new Set([".", "-", "_", "0", " "]); // 消灯
const CHUNK = 16; // 1連結あたり最大バイト数（CHR$(255) 想定でも1行 <255 に収まる）

const num = (v: number): Expr => ({ type: "Num", value: v, raw: String(v) });
const chr = (b: number): Expr => ({ type: "CallExpr", name: "CHR$", args: [{ byRef: false, expr: num(b) }] });
// CHR$(a)+CHR$(b)+… の左結合連結式（bs は 1 個以上）。
const chrChain = (bs: number[]): Expr =>
  bs.map(chr).reduce((a, e) => ({ type: "Bin", op: "+", left: a, right: e }));

export function lowerSprite(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const fail = (key: string, pos: any, params: any = {}) => diags.push(error(key, pos, params));

  const seen = new Set<string>();
  let nextPat = 0;
  let has8 = false;
  let has16 = false;
  let firstPos: any = null;

  // ドット絵 → MSX スプライトパターンのバイト列（失敗時は null）。
  const encode = (s: SpriteDef): number[] | null => {
    const rows = s.rows;
    const n = rows.length;
    if (n === 0) { fail("E_SPRITE_EMPTY", s.pos, { name: s.name }); return null; }
    if (n !== 8 && n !== 16) { fail("E_SPRITE_SIZE", s.pos, { name: s.name, rows: n }); return null; }
    const grid: number[][] = [];
    for (const r of rows) {
      if (r.length !== n) { fail("E_SPRITE_SIZE", s.pos, { name: s.name, rows: n }); return null; }
      const bits: number[] = [];
      for (const ch of r) {
        if (ON_CHARS.has(ch)) bits.push(1);
        else if (OFF_CHARS.has(ch)) bits.push(0);
        else { fail("E_SPRITE_CHAR", s.pos, { name: s.name, ch }); return null; }
      }
      grid.push(bits);
    }
    // 8ビット（左端=MSB）を1バイトに詰める。r0=行, c0=左端列。
    const byteOf = (r0: number, c0: number): number => {
      let b = 0;
      for (let c = 0; c < 8; c++) b = (b << 1) | (grid[r0][c0 + c] ?? 0);
      return b;
    };
    if (n === 8) {
      has8 = true;
      return Array.from({ length: 8 }, (_, r) => byteOf(r, 0));
    }
    // 16×16: 4象限（左上→左下→右上→右下）を各8バイトで連結。
    has16 = true;
    const out: number[] = [];
    for (let r = 0; r < 8; r++) out.push(byteOf(r, 0)); // 左上
    for (let r = 8; r < 16; r++) out.push(byteOf(r, 0)); // 左下
    for (let r = 0; r < 8; r++) out.push(byteOf(r, 8)); // 右上
    for (let r = 8; r < 16; r++) out.push(byteOf(r, 8)); // 右下
    return out;
  };

  // 1スプライト → 展開後の文（CONST ＋ SPRITE$ 代入群）。
  const expand = (s: SpriteDef): Stmt[] => {
    if (seen.has(s.name)) { fail("E_SPRITE_DUP", s.pos, { name: s.name }); return []; }
    seen.add(s.name);
    if (!firstPos) firstPos = s.pos;
    const bytes = encode(s);
    if (!bytes) return [];
    const k = nextPat++;
    const out: Stmt[] = [
      // パターン名→番号の定数。整数ラベルなので STRICT の型サフィックス検査は免除。
      { type: "Const", name: s.name, expr: num(k), pos: s.pos, strictExempt: true },
    ];
    const target: LValue = { type: "ArrayRef", name: "SPRITE$", indices: [num(k)] };
    if (bytes.length <= CHUNK) {
      out.push({ type: "Let", target, expr: chrChain(bytes), hadLet: false, pos: s.pos });
    } else {
      // 255文字制限回避: 一時文字列変数へ分割連結 → 代入。
      const tmp = `__SPR${k}$`;
      const tv: LValue = { type: "Var", name: tmp };
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = chrChain(bytes.slice(i, i + CHUNK));
        const expr: Expr = i === 0 ? part : { type: "Bin", op: "+", left: { type: "Var", name: tmp }, right: part };
        out.push({ type: "Let", target: tv, expr, hadLet: false, pos: s.pos });
      }
      out.push({ type: "Let", target, expr: { type: "Var", name: tmp }, hadLet: false, pos: s.pos });
    }
    return out;
  };

  // Sprite ノードを展開後の文へ置換（ブロック内も再帰）。
  const rw = (ss: Stmt[]): Stmt[] => {
    const res: Stmt[] = [];
    for (const s of ss) {
      switch (s.type) {
        case "Sprite": res.push(...expand(s)); break;
        case "If": res.push({ ...s, then: rw(s.then), else: s.else ? rw(s.else) : undefined }); break;
        case "For": case "While": res.push({ ...s, body: rw(s.body) }); break;
        default: res.push(s);
      }
    }
    return res;
  };

  program.toplevel = rw(program.toplevel);
  for (const fn of program.functions) fn.body = rw(fn.body);

  // 定義が無ければ以降の SCREEN 整合チェックも不要。
  if (!has8 && !has16) return diags;

  // 8×8 と 16×16 の混在は MSX では表現できない（サイズは画面全体で一つ）。
  if (has8 && has16) diags.push(warning("W_SPRITE_MIXED", firstPos ?? ORIGIN, {}));

  // (b) SCREEN のスプライトサイズ引数と定義の整合を検査（触らず警告のみ）。
  // サイズ引数: 0/1=8×8, 2/3=16×16。数値リテラルのときだけ静的に判定する。
  const wantSize = has16 ? 16 : 8;
  const screenArg = findScreenSpriteSize(program);
  if (screenArg != null) {
    const argClass = screenArg <= 1 ? 8 : 16;
    if (argClass !== wantSize) {
      const fix = wantSize === 16 ? 2 : 0;
      diags.push(warning("W_SPRITE_SCREEN", firstPos ?? ORIGIN, { arg: screenArg, want: `${wantSize}×${wantSize}`, mode: "モード", fix }));
    }
  }
  return diags;
}

const ORIGIN = { line: 1, column: 1 } as any;

// 最初の SCREEN 文の第2引数（スプライトサイズ）を数値リテラルとして拾う。無ければ null。
function findScreenSpriteSize(program: Program): number | null {
  let found: number | null = null;
  const scan = (ss: Stmt[]): void => {
    for (const s of ss) {
      if (found != null) return;
      if (s.type === "Builtin" && s.name === "SCREEN") {
        const v = screenArg2(s);
        if (v != null) { found = v; return; }
      } else if (s.type === "If") { scan(s.then); if (s.else) scan(s.else); }
      else if (s.type === "For" || s.type === "While") scan(s.body);
    }
  };
  scan(program.toplevel);
  for (const fn of program.functions) { if (found == null) scan(fn.body); }
  return found;
}

// SCREEN 文の parts をトップレベル "," で区切り、スロット1（第2引数）の数値リテラルを返す。
function screenArg2(s: BuiltinStmt): number | null {
  let slot = 0;
  let val: number | null = null;
  for (const p of s.parts) {
    if (p.kind === "sep" && (p.sep === "," || p.sep === ";")) { slot++; continue; }
    if (slot === 1 && p.kind === "expr" && p.expr.type === "Num") val = p.expr.value;
  }
  return val;
}
