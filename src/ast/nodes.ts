// 抽象構文木（AST）。docs/04 §4.2
import type { Position } from "../core/position.ts";

export type TypeSuffix = "%" | "!" | "#" | "$" | "";

export interface Program {
  type: "Program";
  functions: FunctionDef[];
  toplevel: Stmt[];
  includes: IncludeStmt[];
  strict?: boolean; // STRICT ディレクティブで有効化＝静的型チェック（型サフィックス必須・完全一致）
}

export interface Param {
  name: string; // 型サフィックス込み（例 "IDX", "MSG$"）
  byRef: boolean;
}

export interface FunctionDef {
  type: "FunctionDef";
  name: string; // サフィックス除いた関数名
  retSuffix: TypeSuffix; // 戻り値型（名前サフィックス由来）
  params: Param[];
  body: Stmt[];
  pos: Position;
}

export type Stmt =
  | LetStmt
  | ConstStmt
  | DimStmt
  | GlobalStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | CommentStmt
  | CallStmt
  | BuiltinStmt
  | IfBlock
  | SelectBlock
  | ForBlock
  | WhileBlock
  | OnStmt
  | IncludeStmt
  | AsmStmt
  | DatasetBlock
  | ReadIntoStmt
  | RestoreDatasetStmt;

// インライン Z80 アセンブリ（ASM…END ASM）。lines=生ニーモニック行。
export interface AsmStmt {
  type: "Asm";
  lines: string[];
  pos: Position;
}
export interface LetStmt {
  type: "Let";
  target: LValue;
  expr: Expr;
  hadLet: boolean;
  pos: Position;
}
// 名前付き定数。初期化式は定数畳み込み可能でなければならず、参照は出力でリテラルに
// インライン展開される（MSX変数は生成しない）。初期化以外の代入はトランスパイルエラー。
export interface ConstStmt {
  type: "Const";
  name: string; // 型サフィックス込み（例 "MAX", "PI#", "MSG$"）
  expr: Expr;
  pos: Position;
}
export interface ArrayDecl {
  name: string;
  dims: Expr[];
}
export interface DimStmt {
  type: "Dim";
  decls: ArrayDecl[];
  pos: Position;
}
export interface GlobalStmt {
  type: "Global";
  names: string[];
  pos: Position;
}
export interface ReturnStmt {
  type: "Return";
  expr?: Expr;
  pos: Position;
}
export interface BreakStmt {
  type: "Break";
  enclosingLoopId?: string;
  pos: Position;
}
export interface ContinueStmt {
  type: "Continue";
  enclosingLoopId?: string;
  pos: Position;
}
export interface CommentStmt {
  type: "Comment";
  text: string;
  pos: Position;
}
export interface IncludeStmt {
  type: "Include";
  path: string;
  pos: Position;
}
// 戻り値を捨てるユーザ関数呼び出し（文の位置）
export interface CallStmt {
  type: "Call";
  call: CallExpr;
  pos: Position;
}
// 組み込み命令（PRINT/LOCATE 等）。引数は式と区切り(; ,)の並びとして保持しパススルー。
export type BuiltinPart =
  | { kind: "expr"; expr: Expr }
  | { kind: "sep"; sep: string }
  // 命令中に現れる節キーワード/区切り記号をそのまま素通しする語: COPY ... TO ...、COLOR=(...) の '='。
  | { kind: "word"; word: string };
export interface BuiltinStmt {
  type: "Builtin";
  name: string;
  parts: BuiltinPart[];
  pos: Position;
}

// イベントトラップ／計算分岐: ON SPRITE GOSUB fn / ON x GOTO f1,f2 / ON ERROR GOTO fn 等。
// 飛び先(target)は原則ユーザ関数名(fn)。ON ERROR GOTO 0 等のリテラルは lit に保持。
export interface OnTarget {
  fn?: string;
  lit?: string;
}
export interface OnStmt {
  type: "On";
  event: string; // "SPRITE"|"KEY"|"STRIG"|"STOP"|"INTERVAL"|"ERROR"|"" (空=計算分岐)
  arg?: Expr; // INTERVAL=<arg> の間隔、または計算分岐 ON <arg> の式
  dispatch: "GOTO" | "GOSUB";
  targets: OnTarget[];
  pos: Position;
}

export interface IfBlock {
  type: "If";
  cond: Expr;
  then: Stmt[];
  else?: Stmt[];
  pos: Position;
}
// SELECT CASE 多分岐。パース後、lower-select パスで「一時Let + ネストIfBlock連鎖」へ
// desugar されるため、変換器/最適化/型検査など下流のパスは SelectBlock を見ない。
export type RelOp = "=" | "<>" | "<" | "<=" | ">" | ">=";
export type CaseTest =
  | { kind: "val"; expr: Expr } // CASE expr
  | { kind: "range"; lo: Expr; hi: Expr } // CASE lo TO hi（v2）
  | { kind: "rel"; op: RelOp; expr: Expr }; // CASE IS <rel> expr（v2）
export interface CaseClause {
  tests: CaseTest[]; // CASE 1,3,5 → 3件（OR 結合）
  body: Stmt[];
  pos: Position; // その CASE 行（行対応/provenance 用）
}
export interface SelectBlock {
  type: "Select";
  selector: Expr;
  cases: CaseClause[]; // 宣言順。CASE ELSE は含めない
  else?: Stmt[]; // CASE ELSE の本体
  pos: Position;
}
// 名前付きデータブロック（DATASET name … END DATASET）。本体は DATA 行（と注釈）。
// 変換方式Aは docs/05 §5.16：末尾にラベル付きで DATA を出力し、READ name INTO で
// 「別ブロックなら RESTORE、そして READ」（切替検出は1個の内部整数で。逐次前提）。
export interface DatasetBlock {
  type: "Dataset";
  name: string; // ブロック名（型サフィックス無し。変数ではなくラベル）
  data: Stmt[]; // 本体（DATA / 注釈のみ）
  pos: Position;
}
// READ <dataset> INTO <lvalue> { , <lvalue> } — 名前付きブロックから順に読む。
export interface ReadIntoStmt {
  type: "ReadInto";
  dataset: string;
  targets: LValue[];
  pos: Position;
}
// RESTORE <dataset> — そのブロックの読み取り位置を先頭へ巻き戻す。
export interface RestoreDatasetStmt {
  type: "RestoreDataset";
  dataset: string;
  pos: Position;
}
export interface ForBlock {
  type: "For";
  varName: string;
  from: Expr;
  to: Expr;
  step?: Expr;
  body: Stmt[];
  loopId?: string;
  pos: Position;
}
export interface WhileBlock {
  type: "While";
  cond: Expr;
  body: Stmt[];
  loopId?: string;
  pos: Position;
}

export type LValue = VarRef | ArrayRef;

export type Expr =
  | NumLit
  | StrLit
  | VarRef
  | ArrayRef
  | Unary
  | Binary
  | Group
  | CallExpr;

export interface NumLit {
  type: "Num";
  value: number;
  raw: string;
}
export interface StrLit {
  type: "Str";
  value: string;
}
export interface VarRef {
  type: "Var";
  name: string;
}
// 添字付き参照 A(i,j)。式中の name(args) は一旦 CallExpr で表し、解決時に配列なら ArrayRef へ。
export interface ArrayRef {
  type: "ArrayRef";
  name: string;
  indices: Expr[];
}
export interface Unary {
  type: "Un";
  op: string;
  operand: Expr;
}
export interface Binary {
  type: "Bin";
  op: string;
  left: Expr;
  right: Expr;
}
// 括弧式。優先順位の括弧 `(a+b)` も、座標タプル `(x, y)`（PSET/LINE/PUT SPRITE 等）も表す。
export interface Group {
  type: "Group";
  items: Expr[];
}
export interface Arg {
  byRef: boolean;
  expr: Expr;
}
export interface CallExpr {
  type: "CallExpr";
  name: string;
  args: Arg[];
}

// 識別子から型サフィックスを取り出す
export function suffixOf(name: string): TypeSuffix {
  const last = name.slice(-1);
  if (last === "%" || last === "!" || last === "#" || last === "$") return last;
  return "";
}
