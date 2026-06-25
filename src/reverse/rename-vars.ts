// 素のBASIC→構造化(その4): 使われ方から変数名を役割ベースで推測・改名（やや積極）。
// - ループ変数（FOR v=）→ I/J/K…
// - 座標（PUT SPRITE _,(a,b) / PSET/PRESET/LINE (a,b) / LOCATE a,b）→ X/Y…
// - カウンタ/累算（v=v+… ）→ COUNT…（+1）/ SUM…（+式）
// 型サフィックスは保持。衝突回避（既存名・割当済みを避ける）。文字列/コメント/DATA 内は保護。
// 意味は変えない（純粋なリネーム）。誤推測の可能性はある前提（best-effort）。
import type { BasicLine } from "./basic-reader.ts";
import { isKeyword } from "../lexer/keywords.ts";
import { isBuiltin } from "../core/builtins.ts";

export interface RenameResult {
  lines: BasicLine[];
  renames: { from: string; to: string }[];
}

const ID_RE = /(&?)[A-Za-z][A-Za-z0-9]*[%!#$]?/g;
const isSimpleId = (s: string) => /^[A-Za-z][A-Za-z0-9]*[%!#$]?$/.test(s.trim());
const suffixOf = (id: string) => (/[%!#$]$/.test(id) ? id.slice(-1) : "");
const isSkipLine = (s: string) => /^\s*'|^\s*REM\b/i.test(s) || /^\s*DATA\b/i.test(s);

// コード中のユーザ変数（大文字・サフィックス付き）。キーワード/組み込み/16進は除外。
function codeIds(stmt: string): string[] {
  if (isSkipLine(stmt)) return [];
  const noStr = stmt.replace(/"[^"]*"/g, " ");
  const ids: string[] = [];
  for (const m of noStr.matchAll(ID_RE)) {
    if (m[1] === "&") continue; // &H.. / &B.. リテラル
    const up = m[0].toUpperCase();
    const bare = up.replace(/[%!#$]$/, "");
    if (isKeyword(bare) || isBuiltin(up) || isBuiltin(bare)) continue;
    ids.push(up);
  }
  return ids;
}

export function renameVars(lines: BasicLine[]): RenameResult {
  const flat = lines.flatMap((l) => l.stmts);
  const occupied = new Set<string>();
  for (const s of flat) for (const id of codeIds(s)) occupied.add(id);

  // 役割検出
  const loopOrder: string[] = [];
  const counters = new Map<string, boolean>(); // var → incrementBy1?
  const xVotes = new Map<string, number>();
  const yVotes = new Map<string, number>();
  const vote = (map: Map<string, number>, v: string) => {
    if (isSimpleId(v)) map.set(v.toUpperCase(), (map.get(v.toUpperCase()) ?? 0) + 1);
  };
  for (const s of flat) {
    if (isSkipLine(s)) continue;
    let m = s.match(/^FOR\s+([A-Za-z][A-Za-z0-9]*[%!#$]?)\s*=/i);
    if (m && !loopOrder.includes(m[1].toUpperCase())) loopOrder.push(m[1].toUpperCase());
    m = s.match(/^([A-Za-z][A-Za-z0-9]*[%!#$]?)\s*=\s*([A-Za-z][A-Za-z0-9]*[%!#$]?)\s*([+\-])\s*(\S[\s\S]*)$/i);
    if (m && m[1].toUpperCase() === m[2].toUpperCase()) counters.set(m[1].toUpperCase(), m[4].trim() === "1");
    // 座標: (a,b) を取る命令
    for (const cm of s.matchAll(/(?:PUT\s+SPRITE[^,]*,|PSET|PRESET|LINE)\s*\(([^,()]+),([^,()]+)\)/gi)) {
      vote(xVotes, cm[1]); vote(yVotes, cm[2]);
    }
    const lc = s.match(/^LOCATE\s+([^,]+),([^,:]+)/i);
    if (lc) { vote(xVotes, lc[1]); vote(yVotes, lc[2]); }
  }

  // 役割の優先順位: loop > coord > counter
  const rolled = new Set<string>();
  loopOrder.forEach((v) => rolled.add(v));
  const coordVars = new Set<string>();
  for (const v of new Set([...xVotes.keys(), ...yVotes.keys()])) if (!rolled.has(v)) { coordVars.add(v); rolled.add(v); }
  const counterVars = [...counters.keys()].filter((v) => !rolled.has(v));
  counterVars.forEach((v) => rolled.add(v));

  // 改名先は「据え置く名前(occupied から rolled を除く)」と「割当済み」を避けて採番
  const fixed = new Set([...occupied].filter((n) => !rolled.has(n)));
  const used = new Set<string>(fixed);
  const map = new Map<string, string>(); // oldUpper → newName
  const assign = (oldUp: string, bases: string[]) => {
    const suf = suffixOf(oldUp);
    for (const b of bases) {
      const cand = b + suf;
      if (!used.has(cand.toUpperCase())) { used.add(cand.toUpperCase()); map.set(oldUp, cand); return; }
    }
  };
  const pool = (letters: string[]): string[] => {
    const out = [...letters];
    for (let n = 2; n <= 99; n++) for (const c of letters) out.push(c + n);
    return out;
  };
  // loop: I,J,K,L,M,N,...
  const loopPool = pool(["I", "J", "K", "L", "M", "N"]);
  loopOrder.forEach((v) => assign(v, loopPool));
  // coord: X系/Y系
  for (const v of coordVars) {
    const x = xVotes.get(v) ?? 0, y = yVotes.get(v) ?? 0;
    assign(v, x >= y ? pool(["X"]) : pool(["Y"]));
  }
  // counter: COUNT(+1) / SUM(+式)
  for (const v of counterVars) assign(v, counters.get(v) ? pool(["COUNT"]) : pool(["SUM"]));

  // 適用
  const apply = (stmt: string): string => {
    if (isSkipLine(stmt)) return stmt;
    let out = "";
    let i = 0;
    while (i < stmt.length) {
      const c = stmt[i];
      if (c === '"') { out += c; i++; while (i < stmt.length && stmt[i] !== '"') out += stmt[i++]; if (i < stmt.length) out += stmt[i++]; continue; }
      if (c === "'") { out += stmt.slice(i); break; }
      if (/[A-Za-z]/.test(c)) {
        let j = i + 1;
        while (j < stmt.length && /[A-Za-z0-9]/.test(stmt[j])) j++;
        if (j < stmt.length && /[%!#$]/.test(stmt[j])) j++;
        const id = stmt.slice(i, j);
        const prev = out.replace(/\s+$/, "").slice(-1);
        const repl = prev === "&" ? null : map.get(id.toUpperCase());
        out += repl ?? id;
        i = j;
        continue;
      }
      out += c; i++;
    }
    return out;
  };

  const renamedLines = lines.map((l) => ({ lineNo: l.lineNo, stmts: l.stmts.map(apply) }));
  const renames = [...map.entries()].map(([from, to]) => ({ from, to }));
  return { lines: renamedLines, renames };
}
