// トークン定義。docs/03 §3.1・docs/04 §4.1
import type { Position } from "../core/position.ts";

export type TokenKind =
  | "KEYWORD"
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "OP"
  | "COMMENT"
  | "NEWLINE"
  | "ASM" // ASM…END ASM ブロック。value=本文（改行区切りの生ニーモニック）
  | "EOF";

export interface Token {
  kind: TokenKind;
  // 正規化済みの値：KEYWORD/IDENT/OP/NUMBER は大文字化。STRING/COMMENT は原文のまま。
  value: string;
  // 原文（大文字化前）。エディタ表示・逆変換補助に使用。
  raw: string;
  pos: Position;
}

export const isKind = (t: Token, kind: TokenKind): boolean => t.kind === kind;
