// MSX-BASIC ランタイムエラーの「原因推測」エンジン（アルゴリズム・AIなし）。
// 入力: 変換後 MSX 行配列 + 構造化ソース行 + エラー種別 + （MSXの）行番号。
// 出力: その行にある「そのエラーを起こし得る命令/演算」と制約の一覧、由来ソース行、
//       行に該当が無ければ他行の候補。
//
// なぜ有用か: Syntax error は行が正確だが、Illegal function call 等は「悪い“値”が使われた行」で
// 発火し、値は別の行で作られていることが多い。ここでは静的に「この行のどの引数が範囲外になり得るか」
// を列挙する（フェーズ1。値のさかのぼりはフェーズ2）。あくまで候補の推測であり確定ではない。
import { isBuiltin } from "../core/builtins.ts";
import type { MsxLine } from "../transform/transformer.ts";

export type ErrorKind =
  | "IFC" // Illegal function call（引数が範囲外）
  | "SUBSCRIPT" // Subscript out of range（配列の添字）
  | "DIV0" // Division by zero
  | "OVERFLOW" // Overflow（数値が大きすぎ）
  | "TYPE" // Type mismatch（型不一致）
  | "OUT_OF_DATA" // Out of DATA
  | "UNDEF_LINE"; // Undefined line number

export interface EstimateHit {
  op: string; // 命令/関数名（例 "CHR$", "PUT SPRITE"）
  arg: string; // 引数テキスト（そのMSX行から抜粋。2文字名のまま）
  constraint: string; // 制約の説明（例 "文字コードは 0〜255"）
}
export interface EstimateReport {
  lineNo: number;
  found: boolean; // その行番号のMSX行が存在したか
  msxText: string; // MSX行のテキスト
  srcLines: number[]; // 由来の構造化ソース行（1始まり）
  srcTexts: string[]; // 上の各行の本文
  hits: EstimateHit[]; // この行の原因候補
  note: string; // 補足メッセージ
  nearby: Array<{ lineNo: number; op: string; text: string }>; // 該当が無いとき他行の候補
}

// balanced な括弧で name(...) の引数部を抜き出す（ネスト対応）。
function callArgs(text: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(name.replace(/\$/g, "\\$") + "\\s*\\(", "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    out.push(text.slice(start, i - 1).trim());
  }
  return out;
}

// Illegal function call を起こしうる関数（引数を括弧抽出）。
const IFC_FN: Array<[string, string]> = [
  ["CHR$", "文字コードは 0〜255"],
  ["SPACE$", "個数は 0〜255"],
  ["STRING$", "個数は 0〜255"],
  ["SQR", "引数は 0 以上（負数は不可）"],
  ["LOG", "引数は 0 より大きい正の数"],
  ["TAB", "桁は 0〜255"],
  ["SPC", "個数は 0〜255"],
  ["ASC", "空文字列を渡すと不可"],
  ["LEFT$", "長さは 0〜255"],
  ["RIGHT$", "長さは 0〜255"],
  ["MID$", "開始位置は 1 以上、長さは 0〜255"],
  ["STICK", "番号は 0〜2"],
  ["STRIG", "番号は 0〜4"],
  ["PDL", "番号は 1〜12"],
  ["PAD", "番号は 0〜7"],
  ["BASE", "番号は 0〜19"],
  ["VDP", "レジスタ番号が範囲外"],
  ["SPRITE$", "パターン番号は範囲内（8×8:0〜255 / 16×16:0〜63）"],
  ["VPEEK", "アドレスは VRAM の範囲内"],
];
// Illegal function call を起こしうる文（正規表現で引数部を捕獲）。
const IFC_STMT: Array<[RegExp, string, string]> = [
  [/\bVPOKE\b\s*([^:]*)/i, "VPOKE", "アドレスは VRAM 範囲、値は 0〜255"],
  [/\bPOKE\b\s*([^:]*)/i, "POKE", "値は 0〜255"],
  [/\bPUT\s+SPRITE\b\s*([^:]*)/i, "PUT SPRITE", "プレーン番号は 0〜31、パターン番号も範囲内"],
  [/\bLOCATE\b\s*([^:]*)/i, "LOCATE", "桁は 0〜(画面幅-1)、行は 0〜23"],
  [/\bCOLOR\b\s*(?!=)([^:]*)/i, "COLOR", "色は 0〜15"],
  [/\bSOUND\b\s*([^:]*)/i, "SOUND", "レジスタは 0〜13、値も範囲内"],
  [/\bON\b\s*([^:]*?)\s+GO(?:TO|SUB)\b/i, "ON … GOTO/GOSUB", "選択値は 0〜255"],
];

function scanIFC(text: string): EstimateHit[] {
  const hits: EstimateHit[] = [];
  for (const [fn, con] of IFC_FN)
    for (const arg of callArgs(text, fn)) hits.push({ op: fn, arg, constraint: con });
  for (const [re, op, con] of IFC_STMT) {
    const m = re.exec(text);
    if (m) hits.push({ op, arg: (m[1] ?? "").trim(), constraint: con });
  }
  return hits;
}

// 配列参照 NAME(...) のうち組み込みでないもの＝添字範囲エラーの候補。
function scanSubscript(text: string): EstimateHit[] {
  const hits: EstimateHit[] = [];
  const re = /\b([A-Za-z][A-Za-z0-9]*[%!#$]?)\s*\(/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text))) {
    const name = m[1];
    if (isBuiltin(name) || seen.has(name)) continue;
    seen.add(name);
    const args = callArgs(text, name);
    hits.push({ op: `${name}(…)`, arg: args[0] ?? "", constraint: `配列 ${name} の添字が DIM の範囲外（0〜宣言サイズ）` });
  }
  return hits;
}

function scanDiv0(text: string): EstimateHit[] {
  const hits: EstimateHit[] = [];
  if (/\//.test(text)) hits.push({ op: "/", arg: "", constraint: "除数が 0（右側の値/変数を確認）" });
  if (/\\/.test(text)) hits.push({ op: "\\", arg: "", constraint: "整数除算の除数が 0" });
  if (/\bMOD\b/i.test(text)) hits.push({ op: "MOD", arg: "", constraint: "MOD の右側が 0" });
  return hits;
}

function scanReadData(text: string): EstimateHit[] {
  return /\bREAD\b/i.test(text)
    ? [{ op: "READ", arg: "", constraint: "DATA を読み切った（DATA の個数が足りない／RESTORE 位置ズレ）" }]
    : [];
}

const SCANNERS: Record<ErrorKind, (text: string) => EstimateHit[]> = {
  IFC: scanIFC,
  SUBSCRIPT: scanSubscript,
  DIV0: scanDiv0,
  OUT_OF_DATA: scanReadData,
  OVERFLOW: (text) => (/[-+*^\\]|MOD/i.test(text) ? [{ op: "数値演算/代入", arg: "", constraint: "整数(%)は ±32767 まで。超える計算・代入を確認" }] : []),
  TYPE: (text) => [{ op: "型", arg: "", constraint: "文字列と数値の取り違え（$付き変数に数値、+ で型混在 など）を確認" }],
  UNDEF_LINE: () => [{ op: "GOTO/GOSUB", arg: "", constraint: "飛び先の行番号が存在しない（構造化BASICでは通常出ない＝内部要確認）" }],
};

export function estimateError(
  code: MsxLine[],
  sourceLines: string[],
  kind: ErrorKind,
  lineNo: number,
): EstimateReport {
  const scan = SCANNERS[kind];
  const ml = code.find((l) => l.lineNo === lineNo);
  const srcOf = (m: MsxLine) => (m.src ?? []).filter((n) => n >= 1);
  if (!ml) {
    // 行が無い → 近い行を探す（この行番号が存在しない＝別行の可能性）。
    const near = code.filter((l) => scan(l.text).length > 0).slice(0, 8);
    return {
      lineNo, found: false, msxText: "", srcLines: [], srcTexts: [], hits: [],
      note: `MSX ${lineNo} 行が見つかりません。この種別の命令がある行を候補として表示します。`,
      nearby: near.map((l) => ({ lineNo: l.lineNo, op: scan(l.text)[0].op, text: l.text })),
    };
  }
  const hits = scan(ml.text);
  const srcLines = srcOf(ml);
  const srcTexts = srcLines.map((n) => sourceLines[n - 1] ?? "");
  if (hits.length === 0) {
    const near = code.filter((l) => scan(l.text).length > 0).slice(0, 8);
    return {
      lineNo, found: true, msxText: ml.text, srcLines, srcTexts, hits: [],
      note: "この行に、その種別のエラーを起こす典型的な命令は見つかりませんでした。値を作っている別の行（下の候補）を確認してください。",
      nearby: near.map((l) => ({ lineNo: l.lineNo, op: scan(l.text)[0].op, text: l.text })),
    };
  }
  return {
    lineNo, found: true, msxText: ml.text, srcLines, srcTexts, hits,
    note: hits.length > 1 ? "候補が複数あります。どの引数が範囲外になり得るか、上から確認してください。" : "",
    nearby: [],
  };
}
