// MSX-BASIC 組み込み命令・関数の既定表（docs/12）。
// 実装初期は名前集合のみ。将来は設定で編集/リセット可（docs/12 §12.4）。

// 文として使われる組み込み（行頭に来る）
export const BUILTIN_STATEMENTS: ReadonlySet<string> = new Set([
  "PRINT",
  "INPUT",
  "LOCATE",
  "CLS",
  "SCREEN",
  "COLOR",
  "WIDTH",
  "BEEP",
  "PSET",
  "PRESET",
  "LINE",
  "CIRCLE",
  "PAINT",
  "COPY",
  "DRAW",
  "SOUND",
  "PLAY",
  "POKE",
  "VPOKE",
  "OUT",
  "WAIT",
  "SET",
  "OPEN",
  "CLOSE",
  "GET",
  "PUT",
  "SPRITE",
  "KANJI", // PUT KANJI（漢字表示・MSX2）
  "KEY",
  "FILES",
  "LOAD",
  "SAVE",
  "BLOAD",
  "BSAVE",
  "MAXFILES",
  "DATA",
  "READ",
  "RESTORE",
  "ERASE",
  "CLEAR",
  "SWAP",
  "DEFINT",
  "DEFSNG",
  "DEFDBL",
  "DEFSTR",
  "TIME", // システム変数。読み(T=TIME) も書き(TIME=0) も改名しない。BUILTIN_FUNCTIONS にも掲載。
  "STOP",
  "END",
]);

// 式中で使われる組み込み関数
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([
  "ABS",
  "INT",
  "SQR",
  "SIN",
  "COS",
  "TAN",
  "ATN",
  "LOG",
  "EXP",
  "RND",
  "SGN",
  "FIX",
  "LEFT$",
  "RIGHT$",
  "MID$",
  "CHR$",
  "ASC",
  "LEN",
  "VAL",
  "STR$",
  "HEX$",
  "OCT$",
  "BIN$",
  "INSTR",
  "SPACE$",
  "STRING$",
  "INPUT$",
  "INKEY$",
  "SPRITE$",
  "BASE",
  "VDP",
  "PEEK",
  "VPEEK",
  "INP",
  "STICK",
  "STRIG",
  "PAD",
  "PDL",
  "POINT",
  "PLAY",
  "POS",
  "CSRLIN",
  "VARPTR",
  "FRE",
  "TIME",
  "ERR",
  "ERL",
]);

// 組み込み文の「節キーワード」: 命令の途中にだけ現れ、それ自体は文の先頭にならない語。
// 例: SET PAGE / SET SCROLL の PAGE・SCROLL、COLOR=NEW の NEW、SET TIME の TIME。
// これらは式中で変数として改名してはならない（PAGE→A になると壊れる）。
// ただし文の先頭判定(isBuiltinStatement)には含めない＝ユーザの `PAGE = 5` 等の代入は壊さない。
export const BUILTIN_CLAUSE_WORDS: ReadonlySet<string> = new Set([
  "PAGE", // SET PAGE（アクティブ/表示ページ・MSX2 ダブルバッファ）
  "SCROLL", // SET SCROLL（MSX2+ ハードウェアスクロール）
  "ADJUST", // SET ADJUST（画面位置調整）
  "VIDEO", // SET VIDEO（スーパーインポーズ等）
  "TITLE", // SET TITLE
  "PROMPT", // SET PROMPT
  "PASSWORD", // SET PASSWORD
  "BEEP", // SET BEEP（ビープ音色・MSX2+）※BEEP 文とも両立
  "DATE", // SET DATE / GET DATE
  "TIME", // SET TIME / GET TIME ※TIME 関数とも両立
  "NEW", // COLOR=NEW（パレット初期化・MSX2）
  "RESTORE", // COLOR=RESTORE ※RESTORE 文とも両立
]);

export const isBuiltinStatement = (name: string): boolean =>
  BUILTIN_STATEMENTS.has(name.toUpperCase());
export const isBuiltinClauseWord = (name: string): boolean =>
  BUILTIN_CLAUSE_WORDS.has(name.toUpperCase());
export const isBuiltinFunction = (name: string): boolean =>
  BUILTIN_FUNCTIONS.has(name.toUpperCase());
export const isBuiltin = (name: string): boolean =>
  isBuiltinStatement(name) || isBuiltinFunction(name);
