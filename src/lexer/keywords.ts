// 構造化BASIC の予約語（構文キーワード＋語演算子）。docs/01・docs/03
// 注: PRINT/INPUT/MID$ 等の「組み込み命令・関数」はここには含めず、IDENT として字句解析し、
//     パーサが組み込み表（docs/12）で解決する。REM はコメントとして字句解析側で特別扱い。

export const KEYWORDS: ReadonlySet<string> = new Set([
  // 関数・制御構造
  "FUNCTION",
  "END",
  "IF",
  "THEN",
  "ELSE",
  "FOR",
  "TO",
  "STEP",
  "NEXT",
  // 注: AS は予約語にしない。OPEN/NAME/FIELD の文脈でだけ節キーワードとして扱い（builtins の
  //     BUILTIN_CLAUSE_WORDS + parser 側で限定）、それ以外では通常の変数名として使える
  //     （実MSXでも AS=1.2 は有効。AS をグローバル予約すると素のBASIC取込で誤検出する）。
  "ON", // 末尾修飾: _TURBO ON / SPRITE ON / STOP ON 等（文中で word 素通し）
  "OFF", // 末尾修飾: _TURBO OFF / SPRITE OFF 等
  "WHILE",
  "WEND",
  "RETURN",
  "BREAK",
  "CONTINUE",
  // 宣言・引数
  "LET",
  "CONST",
  "REF",
  "GLOBAL",
  "DIM",
  "INCLUDE",
  "STRICT", // 厳格モード宣言（構造化専用ディレクティブ。MSX出力なし）
  // 語演算子（docs/01 §1.11.2）
  "AND",
  "OR",
  "NOT",
  "XOR",
  "EQV",
  "IMP",
  "MOD",
]);

export const isKeyword = (word: string): boolean => KEYWORDS.has(word.toUpperCase());
