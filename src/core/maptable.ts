// 変換テーブル（逆変換用）。docs/04 §4.4
import type { TypeSuffix } from "../ast/nodes.ts";

export interface VarNameEntry {
  original: string;
  scope: string; // "GLOBAL" or 関数名
  msxName: string;
}

export interface VariantEntry {
  entryLine: number; // この variant の先頭MSX行
  refSubst: Array<{ param: string; actual: string }>; // REF仮引数 → 実引数の2文字名
}

export interface FuncEntry {
  name: string;
  retSuffix: TypeSuffix;
  retVar: string; // 戻り値の2文字名
  params: Array<{ name: string; byRef: boolean }>;
  localVarMap: VarNameEntry[];
  variants: VariantEntry[];
  sourceFile?: string; // 由来ファイル（INCLUDE分割復元用 provenance, docs/06 §6.12）
}

export interface FlowEntry {
  kind: "Break" | "Continue";
  fromLine: number; // GOTOを出した行
  targetLine: number; // 飛び先
  loopId: string;
}

// DATASET（名前付き DATA ブロック。変数ではなく「ラベル」）。docs/05 §5.16
export interface DatasetEntry {
  name: string; // ブロック名（型サフィックス無し）
  restoreLine: number; // RESTORE 先＝先頭 DATA の MSX 行番号
  switchId: number; // ブロック切替検出用の番号（≥1）
  sourceLine?: number; // 由来の構造化ソース行
}

// インライン ASM ブロック（無名。HIMEM 直下へ配置し USR で呼ぶ）。
export interface AsmEntry {
  index: number; // 出現順（1 始まり）
  bytes: number; // 機械語のバイト数（末尾 RET 含む）
  addrVar: string; // 配置アドレスを保持する MSX 変数（! 倍精度）
  guardVar?: string; // 初回パッチのガード変数（%）。パッチ無しなら省略
  patchVars: string[]; // VARPTR パッチ対象の変数名（ASM 内で参照した BASIC 変数）
  sourceLine?: number; // 由来の構造化ソース行
}

// SPRITE ドット絵定義（SPRITE name … END SPRITE）。名前は CONST（パターン番号）へ落ちる。
export interface SpriteEntry {
  name: string; // パターン名
  pattern: number; // 割り当てられたパターン番号（SPRITE$(n) の n）
  size: 8 | 16; // 8×8 か 16×16
  sourceLine?: number; // 由来の構造化ソース行
}

export interface MapTable {
  version: string;
  source: string;
  sources: string[];
  globalVarMap: VarNameEntry[];
  functions: FuncEntry[];
  controlFlow: FlowEntry[];
  datasets?: DatasetEntry[]; // 名前付き DATA ブロック（あれば）
  asmBlocks?: AsmEntry[]; // インライン ASM ブロック（あれば）
  sprites?: SpriteEntry[]; // SPRITE ドット絵定義（あれば）
}
