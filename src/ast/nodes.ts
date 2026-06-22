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
  | DimStmt
  | GlobalStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | CommentStmt
  | CallStmt
  | BuiltinStmt
  | IfBlock
  | ForBlock
  | WhileBlock
  | OnStmt
  | IncludeStmt;

export interface LetStmt {
  type: "Let";
  target: LValue;
  expr: Expr;
  hadLet: boolean;
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
