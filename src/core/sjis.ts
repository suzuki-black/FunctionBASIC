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

export function isSjisLikely(cp: number): boolean {
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
