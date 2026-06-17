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

export interface MapTable {
  version: string;
  source: string;
  sources: string[];
  globalVarMap: VarNameEntry[];
  functions: FuncEntry[];
  controlFlow: FlowEntry[];
}
