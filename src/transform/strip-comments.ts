// コメント除去（オプトイン・速度/サイズ優先ビルド）。出力 MSX 行からコメントを安全に削る。
// 重要: 順方向出力は GOTO/GOSUB/THEN/ELSE による行番号ジャンプを含み、関数の入口は
//       「' === FUNCTION 名 ===」というコメント行が GOSUB の飛び先になっている。よって
//       コメント行を素朴に消すと飛び先が消えて壊れる。
// 方針（再採番なし。MSX は行番号が飛び飛びでも可）:
//   - ジャンプ先になっている行番号を全走査で集める。
//   - コメント専用行: 飛び先でなければ行ごと削除／飛び先なら本文を捨て「'」に最小化して残す。
//   - コード行の行末インラインコメント: 末尾だけ除去（行・番号は不変＝常に安全）。
import type { MsxLine } from "./transformer.ts";

// 文字列リテラルを除去（"..." → ""）してから走査し、文字列内の擬似GOTO等を誤検出しない。
const stripStrings = (t: string): string => t.replace(/"[^"]*"/g, '""');

// 全行からジャンプ先の行番号を集める。
function collectTargets(lines: MsxLine[]): Set<number> {
  const targets = new Set<number>();
  const add = (s: string) => {
    for (const n of s.split(",")) {
      const v = parseInt(n.trim(), 10);
      if (!Number.isNaN(v)) targets.add(v);
    }
  };
  for (const l of lines) {
    const t = stripStrings(l.text);
    // GOTO/GOSUB の後の行番号（ON … GOTO/GOSUB の複数指定 n,n,n を含む）
    for (const m of t.matchAll(/\b(?:GOTO|GOSUB)\b[ \t]*([0-9][0-9,\s]*)/gi)) add(m[1]);
    // THEN/ELSE の直後が行番号（IF … THEN 150 ELSE 160）
    for (const m of t.matchAll(/\b(?:THEN|ELSE)[ \t]+([0-9]+)/gi)) targets.add(parseInt(m[1], 10));
  }
  return targets;
}

// コメント専用行か（行頭が ' または REM）。
const isCommentOnly = (text: string): boolean => /^\s*(?:'|REM\b)/i.test(text);

// 行末インラインコメントの開始位置（なければ -1）。文字列内は無視。
function inlineCommentStart(text: string): number {
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "'") return i;
    // 文の区切り直後の REM（: REM … / 行頭REMはコメント専用行側で処理済み）
    if ((c === "R" || c === "r") && /^REM\b/i.test(text.slice(i))) {
      const before = text.slice(0, i).replace(/\s+$/, "");
      if (before.endsWith(":")) return i;
    }
  }
  return -1;
}

// コード行から行末インラインコメントを除去（直前の : や空白も整理）。
function stripInline(text: string): string {
  const i = inlineCommentStart(text);
  return i < 0 ? text : text.slice(0, i).replace(/[\s:]+$/, "");
}

// コメントを安全に除去した MSX 行配列を返す。
export function stripComments(lines: MsxLine[]): MsxLine[] {
  const targets = collectTargets(lines);
  const out: MsxLine[] = [];
  for (const l of lines) {
    if (isCommentOnly(l.text)) {
      // 飛び先なら行を残す（本文は捨てて最小化）。そうでなければ削除。
      if (targets.has(l.lineNo)) out.push({ lineNo: l.lineNo, text: "'" });
    } else {
      out.push({ lineNo: l.lineNo, text: stripInline(l.text) });
    }
  }
  return out;
}
