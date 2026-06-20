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
  E_RECURSION_UNSUPPORTED: {
    code: "E_RECURSION_UNSUPPORTED",
    ja: (p) => `再帰は未対応です（${p.name} を含む循環）`,
    en: (p) => `Recursion is not supported (cycle involving ${p.name})`,
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
    ja: (p) => `行 ${p.lineNo}: Shift-JIS で表現できない文字 ${p.chars}`,
    en: (p) =>
      `Line ${p.lineNo}: characters not representable in Shift-JIS: ${p.chars}`,
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
