// 診断（エラー/警告）。docs/03 §3.4・docs/04 §4.5
// メッセージは「カタログのキー＋引数」で生成し、日本語/英語を切替できる。
// 各生成箇所は自由文ではなくキー(code を細分したもの)＋params を渡す。
import type { Position } from "./position.ts";

export type Severity = "error" | "warning";
export type Lang = "ja" | "en";

export interface Diagnostic {
  code: string; // 公開コード（例 "E_SYNTAX" / "W_REVERSE_PARTIAL"）
  key: string; // メッセージカタログのキー（通常 code と同じ。E_SYNTAX 等は細分）
  params: DiagParams; // メッセージ差し込み用の引数
  message: string; // 既定言語(ja)の整形済みメッセージ（後方互換・ログ用）
  line: number; // 1始まり（エディタ行番号）
  column: number; // 1始まり
  severity: Severity;
}

export type DiagParams = Record<string, string | number>;
type Tmpl = (p: DiagParams) => string;
interface Entry {
  code: string;
  ja: Tmpl;
  en: Tmpl;
}

// 構文文脈（ctx）の局所化。キーワード/記号はそのまま、説明語のみ英訳する。
const CTX_EN: Record<string, string> = {
  コメント: "comment",
  代入: "assignment",
  代入先: "assignment target",
  呼び出し: "call",
  引数: "argument",
  括弧: "parentheses",
};
const ctx = (c: string | number, lang: Lang): string =>
  lang === "en" ? (CTX_EN[String(c)] ?? String(c)) : String(c);

// 型不一致(E_TYPE_MISMATCH)の文脈キー・型トークンの局所化
const TM_CTX: Record<string, [string, string]> = {
  assign: ["代入", "assignment"],
  arg: ["引数", "argument"],
  ret: ["戻り値", "return value"],
  op: ["演算", "operator"],
  cmp: ["比較", "comparison"],
  index: ["添字", "subscript"],
};
const TM_TYPE: Record<string, [string, string]> = {
  num: ["数値", "numeric"],
  str: ["文字列", "string"],
  "$": ["文字列($)", "string($)"],
  "%": ["整数(%)", "integer(%)"],
  "!": ["単精度(!)", "single(!)"],
  "#": ["倍精度(#)", "double(#)"],
};
const tmCtx = (c: string | number, lang: Lang): string => {
  const e = TM_CTX[String(c)];
  return e ? (lang === "en" ? e[1] : e[0]) : String(c);
};
const tmType = (t: string | number, lang: Lang): string => {
  const e = TM_TYPE[String(t)];
  return e ? (lang === "en" ? e[1] : e[0]) : String(t);
};

// コード別メッセージカタログ（日英）。key が公開 code と異なる場合は code を明示。
const CATALOG: Record<string, Entry> = {
  // --- 字句 ---
  E_UNTERMINATED_STRING: {
    code: "E_UNTERMINATED_STRING",
    ja: () => "文字列が閉じられていません",
    en: () => "Unterminated string",
  },
  E_ILLEGAL_CHAR_NUM: {
    code: "E_ILLEGAL_CHAR",
    ja: (p) => `不正な数値表記です: &${p.radix}`,
    en: (p) => `Invalid number literal: &${p.radix}`,
  },
  E_ILLEGAL_CHAR: {
    code: "E_ILLEGAL_CHAR",
    ja: (p) => `不正な文字です: ${p.char}`,
    en: (p) => `Illegal character: ${p.char}`,
  },
  // --- INCLUDE ---
  E_INCLUDE_CYCLE: {
    code: "E_INCLUDE_CYCLE",
    ja: (p) => `INCLUDE が循環しています: ${p.path}`,
    en: (p) => `Circular INCLUDE: ${p.path}`,
  },
  E_INCLUDE_NOT_FOUND: {
    code: "E_INCLUDE_NOT_FOUND",
    ja: (p) => `INCLUDE 先が見つかりません: ${p.path}`,
    en: (p) => `INCLUDE target not found: ${p.path}`,
  },
  // --- 構造化の制約 ---
  E_BREAK_OUTSIDE_LOOP: {
    code: "E_BREAK_OUTSIDE_LOOP",
    ja: () => "BREAK はループの内側でのみ使用できます",
    en: () => "BREAK can only be used inside a loop",
  },
  E_CONTINUE_OUTSIDE_LOOP: {
    code: "E_CONTINUE_OUTSIDE_LOOP",
    ja: () => "CONTINUE はループの内側でのみ使用できます",
    en: () => "CONTINUE can only be used inside a loop",
  },
  E_RETURN_OUTSIDE_FUNCTION: {
    code: "E_RETURN_OUTSIDE_FUNCTION",
    ja: () => "RETURN は関数の中でのみ使用できます",
    en: () => "RETURN can only be used inside a FUNCTION",
  },
  E_NESTED_FUNCTION: {
    code: "E_NESTED_FUNCTION",
    ja: () => "FUNCTION の中に FUNCTION は定義できません",
    en: () => "Cannot define a FUNCTION inside another FUNCTION",
  },
  E_SELECT_ELSE_LAST: {
    code: "E_SELECT_ELSE_LAST",
    ja: () => "CASE ELSE は SELECT CASE の最後に1つだけ置けます",
    en: () => "CASE ELSE must be the single last clause of a SELECT CASE",
  },
  E_SELECT_UNSUPPORTED: {
    code: "E_SELECT_UNSUPPORTED",
    ja: (p) => `CASE の ${p.feature} はまだ対応していません（範囲 TO・関係 IS は今後対応）`,
    en: (p) => `CASE ${p.feature} is not supported yet (ranges TO / relational IS are planned)`,
  },
  E_DUP_FUNCTION: {
    code: "E_DUP_FUNCTION",
    ja: (p) => `関数 ${p.name} が重複しています`,
    en: (p) => `Duplicate function: ${p.name}`,
  },
  E_REF_NOT_VARIABLE: {
    code: "E_REF_NOT_VARIABLE",
    ja: (p) => `${p.fn}: REF 引数には変数を渡してください`,
    en: (p) => `${p.fn}: a REF argument must be a variable`,
  },
  E_NAME_IS_BUILTIN: {
    code: "E_NAME_IS_BUILTIN",
    ja: (p) => `${p.name} は組み込み（命令/関数）名のため、変数名・関数名には使えません。別名にしてください`,
    en: (p) => `${p.name} is a built-in (statement/function) name and cannot be used as a variable or function name — rename it`,
  },
  E_CONST_ASSIGN: {
    code: "E_CONST_ASSIGN",
    ja: (p) => `定数 ${p.name} には再代入できません（CONST は初期化のみ）`,
    en: (p) => `Cannot assign to constant ${p.name} (CONST is initialize-only)`,
  },
  E_CONST_NOT_CONSTANT: {
    code: "E_CONST_NOT_CONSTANT",
    ja: (p) => `CONST ${p.name} の初期化式は定数畳み込みできません（リテラル/演算/既出の定数のみ可）`,
    en: (p) => `CONST ${p.name}: initializer is not a foldable constant (only literals, operators, and earlier constants)`,
  },
  E_DUP_CONST: {
    code: "E_DUP_CONST",
    ja: (p) => `定数 ${p.name} が重複しています`,
    en: (p) => `Duplicate constant: ${p.name}`,
  },
  E_CONST_TYPE: {
    code: "E_CONST_TYPE",
    ja: (p) => `CONST ${p.name}: 型サフィックスと初期値の型が一致しません`,
    en: (p) => `CONST ${p.name}: type suffix does not match the initializer type`,
  },
  E_STRICT_UNTYPED: {
    code: "E_STRICT_UNTYPED",
    ja: (p) => `STRICT: ${p.name} に型サフィックス(% / ! / # / $)が必要です`,
    en: (p) => `STRICT: ${p.name} needs a type suffix (% / ! / # / $)`,
  },
  E_ASM: {
    code: "E_ASM",
    ja: (p) => `ASM 行 ${p.detail}`,
    en: (p) => `ASM line ${p.detail}`,
  },
  E_TYPE_MISMATCH: {
    code: "E_TYPE_MISMATCH",
    ja: (p) =>
      `${tmCtx(p.ctx, "ja")}${p.detail ? " " + p.detail : ""}: 型が一致しません（${tmType(p.to, "ja")} に ${tmType(p.from, "ja")} は不可。CINT/CSNG/CDBL/INT/FIX/ASC 等で明示変換してください）`,
    en: (p) =>
      `${tmCtx(p.ctx, "en")}${p.detail ? " " + p.detail : ""}: type mismatch (${tmType(p.from, "en")} is not assignable to ${tmType(p.to, "en")}; convert explicitly with CINT/CSNG/CDBL/INT/FIX/ASC …)`,
  },
  E_DEF_UNSUPPORTED: {
    code: "E_DEF_UNSUPPORTED",
    ja: (p) =>
      `${p.kind} は未対応です（変数は2文字名に改名されるため、先頭文字ベースの DEF 型宣言は効きません）。型は変数名のサフィックス % / ! / # / $ で指定してください`,
    en: (p) =>
      `${p.kind} is not supported (variables are renamed to 2-letter names, so first-letter DEF type declarations cannot work); specify types with the name suffixes % / ! / # / $`,
  },
  E_RESUME_LINE: {
    code: "E_RESUME_LINE",
    ja: () =>
      "RESUME に行番号は指定できません（RESUME / RESUME NEXT / RESUME 0 のみ）",
    en: () =>
      "RESUME cannot take a line number (only RESUME / RESUME NEXT / RESUME 0)",
  },
  E_ON_LINE_TARGET: {
    code: "E_ON_LINE_TARGET",
    ja: () =>
      "ON … GOTO/GOSUB の飛び先に行番号は使えません（関数名を指定。ON ERROR GOTO 0 での無効化のみ可）",
    en: () =>
      "ON … GOTO/GOSUB targets cannot be line numbers (use FUNCTION names; only ON ERROR GOTO 0 is allowed)",
  },
  E_RESTORE_LINE: {
    code: "E_RESTORE_LINE",
    ja: () =>
      "RESTORE に行番号は指定できません（構造化BASICには行番号がありません）。引数なしの RESTORE を使ってください",
    en: () =>
      "RESTORE cannot take a line number (Structured BASIC has no line numbers); use a bare RESTORE",
  },
  E_HANDLER_PARAMS: {
    code: "E_HANDLER_PARAMS",
    ja: (p) =>
      `ON … の飛び先 ${p.name} は引数を取れません（ハンドラ/分岐先は引数なしの FUNCTION にしてください）`,
    en: (p) =>
      `ON … target ${p.name} cannot take parameters (handlers / branch targets must be a no-arg FUNCTION)`,
  },
  E_LINE_NUMBER_OVERFLOW: {
    code: "E_LINE_NUMBER_OVERFLOW",
    ja: (p) => `行番号が破綻しました（重複/降順、または MSX 上限 65529 超）: ${p.lineNo}。プログラムを分割してください`,
    en: (p) => `Generated line numbers are invalid (duplicate/descending, or above MSX's 65529 limit) at ${p.lineNo} — split the program`,
  },
  E_RECURSION_UNSUPPORTED: {
    code: "E_RECURSION_UNSUPPORTED",
    ja: (p) => `再帰は未対応です（${p.name} を含む循環）`,
    en: (p) => `Recursion is not supported (cycle involving ${p.name})`,
  },
  E_RECURSION_REF_UNSUPPORTED: {
    code: "E_RECURSION_REF_UNSUPPORTED",
    ja: (p) => `再帰関数では REF（参照渡し）引数は未対応です（${p.name}）`,
    en: (p) => `REF (by-reference) parameters are not supported in a recursive function (${p.name})`,
  },
  E_UNKNOWN_FUNCTION: {
    code: "E_UNKNOWN_FUNCTION",
    ja: (p) => `未定義の関数: ${p.name}`,
    en: (p) => `Undefined function: ${p.name}`,
  },
  E_UNRESOLVED_CALL: {
    code: "E_UNKNOWN_FUNCTION",
    ja: (p) => `未解決の呼び出し: ${p.name}`,
    en: (p) => `Unresolved call: ${p.name}`,
  },
  // --- 出力時の制約 ---
  E_LINE_TOO_LONG: {
    code: "E_LINE_TOO_LONG",
    ja: (p) => `行 ${p.lineNo} が255バイトを超過しました（式の簡略化/分割が必要）`,
    en: (p) =>
      `Line ${p.lineNo} exceeds 255 bytes (simplify or split the expression)`,
  },
  E_NON_SJIS: {
    code: "E_NON_SJIS",
    ja: (p) => `Shift-JIS で表現できない文字（外字）: ${p.chars}`,
    en: (p) => `Characters not representable in Shift-JIS: ${p.chars}`,
  },
  // --- 内部 ---
  E_INTERNAL_LOWER: {
    code: "E_INTERNAL",
    ja: (p) => `式中のユーザ関数呼び出しの lowering 漏れ: ${p.name}()`,
    en: (p) => `Internal: unlowered user-function call in expression: ${p.name}()`,
  },
  E_INTERNAL: {
    code: "E_INTERNAL",
    ja: (p) => `内部エラー: ${p.detail}`,
    en: (p) => `Internal error: ${p.detail}`,
  },
  // --- 逆変換 ---
  W_REVERSE_PARTIAL_GOTO: {
    code: "W_REVERSE_PARTIAL",
    ja: (p) => `GOTO ${p.target} を復元できません`,
    en: (p) => `Cannot reconstruct GOTO ${p.target}`,
  },
  // --- 構文（E_SYNTAX の細分） ---
  E_SYNTAX_INCLUDE_PATH: {
    code: "E_SYNTAX",
    ja: () => "INCLUDE: 文字列パスが必要です",
    en: () => "INCLUDE: a string path is required",
  },
  E_SYNTAX_EXPECT: {
    code: "E_SYNTAX",
    ja: (p) => `${ctx(p.ctx, "ja")}: '${p.v}' が必要です`,
    en: (p) => `${ctx(p.ctx, "en")}: '${p.v}' expected`,
  },
  E_SYNTAX_EOL: {
    code: "E_SYNTAX",
    ja: (p) => `${ctx(p.ctx, "ja")}: 行末が必要です`,
    en: (p) => `${ctx(p.ctx, "en")}: end of line expected`,
  },
  E_SYNTAX_IDENT: {
    code: "E_SYNTAX",
    ja: (p) => `${ctx(p.ctx, "ja")}: 識別子が必要です`,
    en: (p) => `${ctx(p.ctx, "en")}: identifier expected`,
  },
  E_SYNTAX_UNEXPECTED_KW: {
    code: "E_SYNTAX",
    ja: (p) => `予期しないキーワード '${p.v}'`,
    en: (p) => `Unexpected keyword '${p.v}'`,
  },
  E_SYNTAX_EXPR: {
    code: "E_SYNTAX",
    ja: (p) => `式が必要です（${p.kind} '${p.v}'）`,
    en: (p) => `Expression expected (${p.kind} '${p.v}')`,
  },
  E_SYNTAX_STMT: {
    code: "E_SYNTAX",
    ja: (p) => `文が必要です（${p.kind} '${p.v}'）`,
    en: (p) => `Statement expected (${p.kind} '${p.v}')`,
  },
};

export const codeOf = (key: string): string => CATALOG[key]?.code ?? key;

export function formatDiag(
  key: string,
  lang: Lang,
  params: DiagParams = {},
): string {
  const e = CATALOG[key];
  if (!e) return key; // 未知キーはキー名をそのまま（保険）
  return (lang === "en" ? e.en : e.ja)(params);
}

// 既存 Diagnostic を指定言語の文字列へ整形（表示層から使用）。
export const localize = (d: Diagnostic, lang: Lang): string =>
  formatDiag(d.key, lang, d.params);

export const diag = (
  key: string,
  p: Position,
  params: DiagParams,
  severity: Severity,
): Diagnostic => ({
  code: codeOf(key),
  key,
  params,
  message: formatDiag(key, "ja", params),
  line: p.line,
  column: p.column,
  severity,
});

export const error = (
  key: string,
  p: Position,
  params: DiagParams = {},
): Diagnostic => diag(key, p, params, "error");

export const warning = (
  key: string,
  p: Position,
  params: DiagParams = {},
): Diagnostic => diag(key, p, params, "warning");

export const hasError = (ds: Diagnostic[]): boolean =>
  ds.some((d) => d.severity === "error");
