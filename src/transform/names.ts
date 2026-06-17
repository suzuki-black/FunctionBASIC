// 2文字MSX名アロケータ。docs/05 §5.11・docs/01 §1.10.3
// MSX変数名は先頭2文字のみ有効。型別プール（% ! # $）。デフォルト(単精度)はサフィックス無しで出力。
import type { TypeSuffix } from "../ast/nodes.ts";

// 2文字の予約語（サフィックス有無に関わらず避ける）
const RESERVED_BASES = new Set(["IF", "TO", "ON", "OR", "FN"]);

function* baseGenerator(): Generator<string> {
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const D = "0123456789";
  for (const c of L) yield c; // 1文字
  for (const a of L) for (const b of L + D) yield a + b; // 2文字
}

// 型サフィックスを出力表記へ（単精度はサフィックス無し）
const outSuffix = (t: TypeSuffix): string => (t === "!" || t === "" ? "" : t);

// 型ごとに独立した2文字名プール
export class NamePool {
  private gens: Record<string, Generator<string>> = {};

  private gen(t: TypeSuffix): Generator<string> {
    const key = t || "!";
    if (!this.gens[key]) this.gens[key] = baseGenerator();
    return this.gens[key];
  }

  // 次の空き2文字名（出力表記、例 "A" / "AB%" / "C$"）
  next(t: TypeSuffix): string {
    const g = this.gen(t);
    for (;;) {
      const r = g.next();
      if (r.done) throw new Error("E_VAR_NAMES_EXHAUSTED");
      if (RESERVED_BASES.has(r.value)) continue;
      return r.value + outSuffix(t);
    }
  }
}
