// 字句解析。docs/03 §3.1
// ソース文字列 → トークン列＋診断。
// - KEYWORD/IDENT/OP/NUMBER は value を大文字化（docs/01 §1.6）。STRING/COMMENT は原文保持。
// - エラーがあっても可能な範囲でトークン化を継続する。
import type { Token, TokenKind } from "./token.ts";
import { isKeyword } from "./keywords.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";
import type { Position } from "../core/position.ts";
import { findNonSjis } from "../core/sjis.ts";

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isAlpha = (c: string): boolean =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
// 構造化側の識別子は英字始まり、以降 英数字 と _ を許可（_ は入力名では可）。
// 先頭 '_' は MSX の拡張ステートメント短縮形（_MUSIC = CALL MUSIC）なので識別子
// として字句化し、パーサが文頭の '_…' を CALL 相当として扱う。
const isIdentStart = (c: string): boolean => isAlpha(c) || c === "_";
const isIdentPart = (c: string): boolean => isAlpha(c) || isDigit(c) || c === "_";
const isTypeSuffix = (c: string): boolean =>
  c === "%" || c === "!" || c === "#" || c === "$";

export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const here = (): Position => ({ line, column: col });
  const peek = (o = 0): string => source[i + o] ?? "";
  const advance = (): string => {
    const c = source[i++];
    col++;
    return c;
  };
  const push = (
    kind: TokenKind,
    value: string,
    raw: string,
    p: Position,
  ): void => {
    tokens.push({ kind, value, raw, pos: p });
  };
  // 外字チェック: Shift-JIS で表せない文字がコメント/文字列に混ざると MSX 出力が
  // 壊れる。そのまま出力へ通る箇所（COMMENT/STRING）を字句化時に検査し、該当ソース
  // 位置でエラーにする（識別子/キーワードは ASCII 化されるので対象外）。
  const checkSjis = (text: string, p: Position): void => {
    const bad = findNonSjis(text);
    if (bad.length > 0)
      diagnostics.push(error("E_NON_SJIS", p, { chars: JSON.stringify(bad.join("")) }));
  };

  while (i < n) {
    const start = here();
    const c = peek();

    // 改行
    if (c === "\n") {
      advance();
      push("NEWLINE", "\n", "\n", start);
      line++;
      col = 1;
      continue;
    }
    if (c === "\r") {
      // CRLF / CR
      advance();
      if (peek() === "\n") advance();
      push("NEWLINE", "\n", "\r\n", start);
      line++;
      col = 1;
      continue;
    }

    // 空白（改行以外）
    if (c === " " || c === "\t") {
      advance();
      continue;
    }

    // コメント '...
    if (c === "'") {
      let raw = "";
      while (i < n && peek() !== "\n" && peek() !== "\r") raw += advance();
      push("COMMENT", raw, raw, start);
      checkSjis(raw, start);
      continue;
    }

    // 文字列 "..."
    if (c === '"') {
      advance(); // 開き "
      let body = "";
      let closed = false;
      while (i < n) {
        const ch = peek();
        if (ch === '"') {
          advance();
          closed = true;
          break;
        }
        if (ch === "\n" || ch === "\r") break; // 行内で閉じる必要あり
        body += advance();
      }
      if (!closed) {
        diagnostics.push(
          error("E_UNTERMINATED_STRING", start),
        );
      }
      push("STRING", body, '"' + body + (closed ? '"' : ""), start);
      checkSjis(body, start);
      continue;
    }

    // MSX-MUSIC のボイス参照 @nn（CALL VOICE(@3,@23) 等）。文字列外の '@<数字>' は
    // 音色番号リテラルとして raw を保持して素通しする（MML 文字列内の @ は STRING 側で保持）。
    if (c === "@" && isDigit(peek(1))) {
      let raw = advance(); // @
      while (i < n && isDigit(peek())) raw += advance();
      push("NUMBER", raw.toUpperCase(), raw, start);
      continue;
    }

    // 数値（10進・&H/&O/&B）
    if (isDigit(c) || (c === "." && isDigit(peek(1))) || c === "&") {
      let raw = "";
      if (c === "&") {
        raw += advance(); // &
        const radix = peek().toUpperCase();
        if (radix === "H" || radix === "O" || radix === "B") {
          raw += advance(); // H/O/B
          while (i < n && /[0-9A-Fa-f]/.test(peek())) raw += advance();
        } else {
          diagnostics.push(
            error("E_ILLEGAL_CHAR_NUM", start, { radix }),
          );
        }
      } else {
        while (i < n && isDigit(peek())) raw += advance();
        if (peek() === ".") {
          raw += advance();
          while (i < n && isDigit(peek())) raw += advance();
        }
        // 指数表記 1E5 / 1.5E-3 / 2D+10（MSXは E=単精度, D=倍精度）
        const ex = peek().toUpperCase();
        if ((ex === "E" || ex === "D") && /[0-9+\-]/.test(peek(1))) {
          raw += advance(); // E/D
          if (peek() === "+" || peek() === "-") raw += advance();
          while (i < n && isDigit(peek())) raw += advance();
        }
        // 数値リテラルの型サフィックス（%整数 / !単精度 / #倍精度）。例: 2.8# / 50000! / .5!
        if (peek() === "%" || peek() === "!" || peek() === "#") raw += advance();
      }
      push("NUMBER", raw.toUpperCase(), raw, start);
      continue;
    }

    // 識別子・キーワード（REM はコメント扱い）
    if (isIdentStart(c)) {
      let raw = "";
      while (i < n && isIdentPart(peek())) raw += advance();
      // 型サフィックス
      if (isTypeSuffix(peek())) raw += advance();
      const upper = raw.toUpperCase();

      // REM コメント
      if (upper === "REM") {
        let rest = raw;
        while (i < n && peek() !== "\n" && peek() !== "\r") rest += advance();
        push("COMMENT", rest, rest, start);
        checkSjis(rest, start);
        continue;
      }

      // ASM ブロック: 単独行の "ASM" で始まり "END ASM" までを生取り込みする。
      if (upper === "ASM") {
        let j = i;
        while (j < n && (source[j] === " " || source[j] === "\t")) j++;
        const after = source[j];
        if (after === undefined || after === "\n" || after === "\r" || after === "'") {
          while (i < n && peek() !== "\n" && peek() !== "\r") advance(); // ASM 行の残りを捨てる
          const bodyLines: string[] = [];
          while (i < n) {
            if (peek() === "\r") advance();
            if (peek() === "\n") advance();
            line++; col = 1;
            let lraw = "";
            while (i < n && peek() !== "\n" && peek() !== "\r") lraw += advance();
            if (/^\s*END\s+ASM\s*$/i.test(lraw)) break; // END ASM で終了
            bodyLines.push(lraw);
          }
          const body = bodyLines.join("\n");
          push("ASM", body, body, start);
          continue;
        }
      }

      if (isKeyword(upper)) push("KEYWORD", upper, raw, start);
      else push("IDENT", upper, raw, start);
      continue;
    }

    // 演算子・記号
    const two = c + peek(1);
    if (two === "<=" || two === ">=" || two === "<>") {
      advance();
      advance();
      push("OP", two, two, start);
      continue;
    }
    // '#' はファイル番号(PRINT #1 等)の記号。型サフィックス(A#)は識別子側で
    // 先に消費されるため、ここに来る '#' は単独記号＝OP として扱う。
    if ("+-*/\\^=<>(),:;#".includes(c)) {
      advance();
      push("OP", c, c, start);
      continue;
    }

    // 不正文字
    advance();
    diagnostics.push(
      error("E_ILLEGAL_CHAR", start, { char: JSON.stringify(c) }),
    );
  }

  tokens.push({ kind: "EOF", value: "", raw: "", pos: here() });
  return { tokens, diagnostics };
}
