// 診断（エラー/警告）。docs/03 §3.4・docs/04 §4.5
import type { Position } from "./position.ts";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string; // 例 "E_UNTERMINATED_STRING" / "W_ARRAY_VALUE_COPY"
  message: string; // 日本語メッセージ
  line: number; // 1始まり（エディタ行番号）
  column: number; // 1始まり
  severity: Severity;
}

export const diag = (
  code: string,
  p: Position,
  message: string,
  severity: Severity,
): Diagnostic => ({ code, message, line: p.line, column: p.column, severity });

export const error = (code: string, p: Position, message: string): Diagnostic =>
  diag(code, p, message, "error");

export const warning = (code: string, p: Position, message: string): Diagnostic =>
  diag(code, p, message, "warning");

export const hasError = (ds: Diagnostic[]): boolean =>
  ds.some((d) => d.severity === "error");
