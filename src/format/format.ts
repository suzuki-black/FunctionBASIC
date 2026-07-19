// FunctionBASIC 整形（reformat）。docs/13「スタイルガイド」§13.2（R1–R5）の**リファレンス実装**。
// 純粋関数（DOM 非依存）＝ editor/app.js と test/format.test.ts の双方から使う。
//   R1 大文字化（文字列/コメントは保持）／R2 インデント（4スペース・ブロック規則・ASM本体不可侵）
//   R3 1文1行（言語規則。パーサが担保）／R4 行内の連続空白を1個へ（文字列/末尾コメント桁揃えは保護）
//   R5 コメント（行頭は先頭空白のみ正規化・本文不変／末尾コメントは不変）
// casing と空白のみ変更し**意味は変えない**（整形前後で変換後 MSX-BASIC は不変）。
import { tokenize } from "../lexer/lexer.ts";

const INDENT_UNIT = "    "; // R2: 1 段 = 半角スペース 4

function lineStartsOf(src: string): number[] {
  const a = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") a.push(i + 1);
  return a;
}

// R1 + R4: 大小文字を正規化しつつ行内の連続空白を詰める。トークン境界で走査するため
// ASM ブロック（本体が 1 トークン）でも行を落とさない。
function recase(src: string): string {
  const { tokens } = tokenize(src);
  const ls = lineStartsOf(src);
  const off = (p: { line: number; column: number }) => ls[p.line - 1] + (p.column - 1);
  const real = tokens.filter((t) => t.kind !== "EOF");
  const nl = (s: string) => "\n".repeat((s.match(/\n/g) || []).length);
  let out = "";
  let pos = 0;
  for (let i = 0; i < real.length; i++) {
    const t = real[i];
    const s = off(t.pos);
    const gap = src.slice(pos, s);
    if (gap.includes("\n")) out += nl(gap);        // 行境界: 改行だけ残す（インデントは reindent が振り直す）
    else if (t.kind === "COMMENT") out += gap;     // R5: 末尾コメント前の桁揃え空白は温存
    else out += gap.length ? " " : "";             // R4: 行内の連続空白は 1 個へ（無空白は無空白のまま）
    pos = s;
    if (t.kind === "ASM") { const e = i + 1 < real.length ? off(real[i + 1].pos) : src.length; out += src.slice(s, e); pos = e; continue; }
    if (t.kind === "KEYWORD" || t.kind === "IDENT" || t.kind === "NUMBER") out += t.value; // R1: 大文字化
    else out += t.raw;                             // 記号 / 文字列 / コメント（原文保持）
    pos = s + t.raw.length;
  }
  if (pos < src.length) { const g = src.slice(pos); out += g.includes("\n") ? nl(g) : g; }
  return out;
}

// R2 + R4 + R5: 行単位でブロック構造に合わせてインデントを振り直す。ASM…END ASM の本体は触らない。
function reindent(src: string): string {
  const lines = src.split("\n");
  const outLines: string[] = [];
  const stack: string[] = []; // 開いているブロック種別（段数 = stack.length）
  let inAsm = false;
  const firstWord = (s: string) => (s.match(/^([A-Za-z_][A-Za-z0-9_$%!#]*)/) || [, ""])[1].toUpperCase();
  const isOpener = (w: string) => ["FUNCTION", "FOR", "WHILE", "DO", "STRUCT", "DATASET", "EVENT"].includes(w);
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");       // R4: 行末空白を除去
    const trimmed = line.replace(/^[ \t]+/, "");
    if (inAsm) {                                    // R2: ASM 本体は原文のインデントのまま。区切り END ASM は R1 で大文字化
      if (/^END\s+ASM\b/i.test(trimmed)) { inAsm = false; outLines.push(INDENT_UNIT.repeat(stack.length) + trimmed.toUpperCase()); }
      else outLines.push(line);
      continue;
    }
    if (trimmed === "") { outLines.push(""); continue; } // R4: 空行はインデント無し
    const w = firstWord(trimmed);
    if (w === "ASM" && /^ASM\s*$/i.test(trimmed)) { outLines.push(INDENT_UNIT.repeat(stack.length) + trimmed.toUpperCase()); inAsm = true; continue; } // R1: 区切り ASM も大文字化
    let indent = stack.length;
    if (/^END\s+(IF|FUNCTION|SELECT|STRUCT|DATASET|EVENT)\b/i.test(trimmed)) {
      if (stack[stack.length - 1] === "CASE") stack.pop(); // SELECT 内の最後の CASE 本体を閉じる
      stack.pop();
      indent = stack.length;
    } else if (w === "NEXT" || w === "WEND" || w === "LOOP") {
      stack.pop();
      indent = stack.length;
    } else if (w === "CASE") {
      if (stack[stack.length - 1] === "CASE") stack.pop();
      indent = stack.length;
    } else if (w === "ELSE" || w === "ELSEIF") {
      indent = Math.max(0, stack.length - 1);
    }
    if (indent < 0) indent = 0;
    outLines.push(INDENT_UNIT.repeat(indent) + trimmed); // R5: コメント行も行頭のみ正規化（本文は trimmed に含まれ不変）
    if (isOpener(w)) stack.push(w);
    else if (w === "SELECT") stack.push("SELECT");
    else if (w === "CASE") stack.push("CASE");
    else if (w === "IF" && /\bTHEN\s*('.*)?$/i.test(trimmed)) stack.push("IF"); // ブロック IF のみ（1行IF は開かない）
  }
  return outLines.join("\n");
}

/** docs/13 §13.2 準拠の整形。casing と空白のみ変更し、意味（変換後 MSX-BASIC）は変えない。 */
export function formatSource(src: string): string {
  return reindent(recase(src));
}
