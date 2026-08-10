// Shift-JIS 可否判定(近似)の回帰。範囲ホワイトリスト＋個別ブラックリストの穴を固定する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { findNonSjis, isSjisLikely } from "../src/core/sjis.ts";

test("JIS X 0208 にある単方向矢印 ← ↑ → ↓ は SJIS 可", () => {
  for (const ch of ["←", "↑", "→", "↓"]) {
    assert.equal(isSjisLikely(ch.codePointAt(0)), true, `${ch} は可のはず`);
  }
});

test("JIS X 0208 に無い矢印(双方向/斜め)は SJIS 不可として検出", () => {
  for (const ch of ["↔", "↕", "↖", "↗", "↘", "↙"]) {
    assert.equal(isSjisLikely(ch.codePointAt(0)), false, `${ch} は不可のはず`);
    assert.deepEqual(findNonSjis(`x${ch}y`), [ch], `${ch} が抽出される`);
  }
});

test("波ダッシュ U+301C は従来どおり不可、通常文字は可", () => {
  assert.equal(isSjisLikely(0x301c), false, "〜 U+301C は不可");
  assert.deepEqual(findNonSjis("ABCあいう漢字。"), [], "通常文字は全て可");
});
