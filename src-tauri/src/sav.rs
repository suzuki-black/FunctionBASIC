// MSXPLAYer 仮想フロッピー（.sav）書き出し。
//
// 本モジュールのフォーマット仕様は、以下の MIT License ソフトウェアのソースコードから
// 確定したものに基づく（コードの逐語移植ではなく Rust での再実装）:
//   - SAVList        Copyright (c) 2005,2017 Tatsuhiko Syoji  (MIT License)
//                    https://github.com/Tatsu-syo/SAVList
//                    （common/savFile.c, common/fatFs.c, file2sav/file2sav.c）
//   - MakeBlankSav   Copyright (c) 2025 Tatsuhiko Syoji  (MIT License)
//                    https://github.com/Tatsu-syo/MakeBlankSav
//                    （makeBlankSav.c）
//
// .sav 物理フォーマット（2DD 720KB / 1440 セクタ・512 バイト）:
//   ヘッダもフッタも無い。ファイル先頭から 516 バイトのブロックが連続するだけ。
//     ブロック = [セクタ番号 4バイト LE][セクタ内容 512バイト]
//     ファイル = ブロック × N （N は書き込まれたセクタ数）
//   - セクタ番号は LE 32bit。並び順は不問。重複・>=1440 は不正。
//   - ファイルに存在しないセクタ = まだ書かれていない（ゼロとみなされる）セクタ。
//
// 本実装は「フルイメージ（標準 FAT12 の .dsk バイト列）からの一括生成」に責務を限定し、
// FAT の構造は一切解釈しない（容れ物の詰め替えだけを行う）。

const SECTOR: usize = 512;
const TOTAL_SECTORS: usize = 1440; // 2DD 720KB
const IMAGE_LEN: usize = SECTOR * TOTAL_SECTORS; // 737280
const BLOCK: usize = 4 + SECTOR; // 516

#[derive(Debug, PartialEq, Eq)]
pub enum SavError {
    /// 入力イメージ長が 1440×512=737280 バイトでない。
    BadImageLen(usize),
}

impl std::fmt::Display for SavError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SavError::BadImageLen(n) => write!(
                f,
                "FAT12 フルイメージのサイズが不正です（{n} バイト, 期待値 {IMAGE_LEN}）"
            ),
        }
    }
}

/// 1440×512 のフル FAT12 イメージ → .sav バイト列（案1: 全 1440 セクタを出力）。
///
/// セクタ番号 0..1440 を昇順に 1 パスで `[番号 4B LE][512B]` として追記する。
/// 昇順 1 パスのため重複セクタは原理的に発生しない。
pub fn dsk_to_sav(image: &[u8]) -> Result<Vec<u8>, SavError> {
    if image.len() != IMAGE_LEN {
        return Err(SavError::BadImageLen(image.len()));
    }
    let mut out = Vec::with_capacity(TOTAL_SECTORS * BLOCK);
    for sector in 0..TOTAL_SECTORS {
        out.extend_from_slice(&(sector as u32).to_le_bytes());
        let off = sector * SECTOR;
        out.extend_from_slice(&image[off..off + SECTOR]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 指示書 §1.3 の読み込みアルゴリズム（参考: savFile.c initialize）。
    // .sav をパースして 1440×512 のフルイメージへ復元する。重複・範囲外はエラー。
    fn sav_to_image(sav: &[u8]) -> Result<Vec<u8>, String> {
        if sav.len() % BLOCK != 0 {
            return Err(format!("ブロック境界に整列していません: {} バイト", sav.len()));
        }
        let mut image = vec![0u8; IMAGE_LEN];
        let mut seen = vec![false; TOTAL_SECTORS];
        let mut pos = 0;
        while pos < sav.len() {
            let n =
                u32::from_le_bytes([sav[pos], sav[pos + 1], sav[pos + 2], sav[pos + 3]]) as usize;
            if n >= TOTAL_SECTORS {
                return Err(format!("セクタ番号が範囲外: {n}"));
            }
            if seen[n] {
                return Err(format!("セクタ番号が重複: {n}"));
            }
            seen[n] = true;
            let src = pos + 4;
            let off = n * SECTOR;
            image[off..off + SECTOR].copy_from_slice(&sav[src..src + SECTOR]);
            pos += BLOCK;
        }
        Ok(image)
    }

    // D-1: ラウンドトリップ。dsk_to_sav の出力をパースし直すと元イメージに一致する。
    #[test]
    fn roundtrip_full_image() {
        // 非ゼロのパターンを各セクタに散らした擬似フルイメージ。
        let mut image = vec![0u8; IMAGE_LEN];
        for (i, b) in image.iter_mut().enumerate() {
            *b = (i % 251) as u8; // 251 は素数: セクタ境界(512)と周期が揃わない
        }

        let sav = dsk_to_sav(&image).unwrap();

        // サイズ: 案1 は全 1440 ブロック固定。
        assert_eq!(sav.len(), TOTAL_SECTORS * BLOCK);

        // 先頭ブロックのセクタ番号は 0、2 ブロック目は 1（昇順 LE）。
        assert_eq!(&sav[0..4], &[0, 0, 0, 0]);
        assert_eq!(&sav[BLOCK..BLOCK + 4], &[1, 0, 0, 0]);

        // パースし直して完全一致。重複・範囲外も無い（sav_to_image がエラーを返さない）。
        let restored = sav_to_image(&sav).unwrap();
        assert_eq!(restored, image);
    }

    // 入力長が不正なら BadImageLen。
    #[test]
    fn rejects_bad_length() {
        assert_eq!(dsk_to_sav(&[0u8; 10]), Err(SavError::BadImageLen(10)));
        assert_eq!(
            dsk_to_sav(&vec![0u8; IMAGE_LEN - 1]),
            Err(SavError::BadImageLen(IMAGE_LEN - 1))
        );
    }
}
