// Shift-JIS(JIS X 0201 ＋ JIS X 0208) エンコード可否の簡易判定。docs/08 §8.6.4
// 注: 厳密な可否判定には JIS X 0208 の文字テーブルが必要。ここでは「明らかにSJIS外」
//     （絵文字・補助面・CP932固有拡張・非対応スクリプト等）を検出する近似ヒューリスティック。
//     ドライバ実装で実コーデック（iconv等）に差し替え可能。

const RANGES: Array<[number, number]> = [
  [0x00, 0x7f], // ASCII / JIS X 0201 ラテン
  [0xff61, 0xff9f], // 半角カナ (JIS X 0201)
  [0x3000, 0x303f], // CJK記号・句読点
  [0x3040, 0x309f], // ひらがな
  [0x30a0, 0x30ff], // カタカナ
  [0xff01, 0xff5e], // 全角英数記号
  [0xffe0, 0xffe6], // 全角記号
  [0x4e00, 0x9fff], // CJK統合漢字（JIS X 0208 はこの一部）
  [0x0391, 0x03c9], // ギリシャ文字
  [0x0401, 0x0451], // キリル文字（一部）
  [0x2010, 0x2312], // 各種記号（罫線・矢印等、近似）
  [0x2460, 0x24ff], // 丸数字等
];

// RANGES(0x3000-0x303f 等) 内に入ってしまうが、実コーデック（WHATWG/encoding_rs の Shift_JIS）
// ではマップできない文字。IME が「から」で出しがちな波ダッシュ U+301C が代表格で、実際に保存が
// 失敗する（0x8160 には全角チルダ ～ U+FF5E が割り当てられているため U+301C は不可）。範囲判定
// の見逃しを個別に補正する。※EMダッシュ U+2014 等は既存サンプルでも使われ、ここでは扱わない
// （必要になれば encoding_rs の挙動を確認の上で追加する）。
export const SJIS_UNMAPPABLE: ReadonlyMap<number, string> = new Map([
  // 〜(U+301C) と ～(U+FF5E) は見た目がほぼ同一なので、置換先をコードポイントで明示する。
  [0x301c, "〜 U+301C → ～ U+FF5E か -"],
]);

export function isSjisLikely(cp: number): boolean {
  if (SJIS_UNMAPPABLE.has(cp)) return false;
  return RANGES.some(([a, b]) => cp >= a && cp <= b);
}

// SJISで表現できなさそうな文字を抽出（空なら全てOK）
export function findNonSjis(text: string): string[] {
  const bad: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!isSjisLikely(cp) && !bad.includes(ch)) bad.push(ch);
  }
  return bad;
}

// SJIS で保存できない文字を「行・桁つき」で列挙（エディタの診断/ガター印に使う）。
// hint は置換候補の案内（既知の紛らわしい文字のみ。未知はサロゲート考慮の一般案内）。
export function findNonSjisPositions(
  text: string,
): Array<{ line: number; column: number; char: string; cp: number; hint: string }> {
  const out: Array<{ line: number; column: number; char: string; cp: number; hint: string }> = [];
  let line = 1;
  let column = 1;
  for (const ch of text) {
    if (ch === "\n") { line++; column = 1; continue; }
    const cp = ch.codePointAt(0)!;
    if (!isSjisLikely(cp)) {
      out.push({ line, column, char: ch, cp, hint: SJIS_UNMAPPABLE.get(cp) ?? "Shift-JIS(JIS X 0208)に無い文字です" });
    }
    column += ch.length; // UTF-16 コード単位（レキサ/桁と一致）
  }
  return out;
}
