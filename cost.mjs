// FunctionBASIC 静的コスト解析 CLI（実機較正・turbo R）。
// 使い方: node --experimental-strip-types cost.mjs <file.msxb> [--tree] [--fn NAME] [--min TK]
//   既定: flat順位＋毎フレーム木＋上位関数の木。--fn で特定関数の木のみ。--min で枝の表示閾値(tk)。
import { readFileSync } from "node:fs";
import { tokenize } from "./src/lexer/lexer.ts";
import { parse } from "./src/parser/parser.ts";
import { resolveIncludes } from "./src/preprocess/include.ts";
import { analyzeCost } from "./src/analyze/cost.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const onlyFn = (() => { const i = args.indexOf("--fn"); return i >= 0 ? args[i + 1] : null; })();
const minTk = (() => { const i = args.indexOf("--min"); return i >= 0 ? Number(args[i + 1]) : 0.05; })();
if (!file) { console.error("usage: node --experimental-strip-types cost.mjs <file.msxb> [--fn NAME] [--min TK]"); process.exit(1); }

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const inc = resolveIncludes(file, read);
const src = inc.source ?? readFileSync(file, "utf8");
const tk = tokenize(src);
const ast = parse(tk.tokens ?? tk);
const rep = analyzeCost(ast.program ?? ast);

const T = (n) => (n / 2000).toFixed(2);
const pad = (s, w) => String(s).padStart(w);

// ---- tree renderer (prune small nodes, sort desc, hotspot ◆) ----
function renderNode(node, depth, parentIncl) {
  const tkv = node.incl / 2000;
  const ind = "  ".repeat(depth);
  const share = parentIncl > 0 ? ` ${Math.round(100 * node.incl / parentIncl)}%` : "";
  const hot = node.hot ? `  ◆${node.hot}` : "";
  const iters = node.iters ? ` [x${node.iters}]` : "";
  console.log(`${ind}${pad(T(node.incl), 7)} tk${share.padStart(5)}  ${node.label}${iters}${hot}`);
  const kids = [...node.children].sort((a, b) => b.incl - a.incl);
  let shown = 0, restIncl = 0, restN = 0;
  for (const c of kids) {
    if (c.incl / 2000 >= minTk && shown < 12) { renderNode(c, depth + 1, node.incl); shown++; }
    else { restIncl += c.incl; restN++; }
  }
  if (restN > 0 && restIncl / 2000 >= 0.02) console.log(`${"  ".repeat(depth + 1)}${pad(T(restIncl), 7)} tk        … (${restN} minor)`);
}

console.log(`# static cost — ${file}`);
console.log(`# ${rep.note}\n`);

if (onlyFn) {
  const t = rep.funcTrees.find((n) => n.label.endsWith(onlyFn));
  if (!t) { console.error(`function not found: ${onlyFn}`); process.exit(1); }
  console.log("== function tree ==");
  renderNode(t, 0, 0);
} else {
  console.log("== flat: reachable functions by self cost (own statements, callees excluded) ==");
  const reach = rep.functions.filter((f) => f.reachable).sort((a, b) => b.self - a.self);
  for (const f of reach.slice(0, 16))
    console.log(`  self ${pad(T(f.self), 7)}  incl ${pad(T(f.inclusive), 7)} tk  ${f.name}`);
  const unused = rep.functions.filter((f) => !f.reachable);
  if (unused.length)
    console.log(`  (未使用/DCE除去: ${unused.map((f) => f.name).join(", ")})`);

  console.log("\n== per-frame path (MAIN WHILE tree; branches split) ==");
  if (rep.frameTree) renderNode(rep.frameTree, 0, 0);

  console.log("\n== top function trees (inclusive) ==");
  for (const t of rep.funcTrees.slice(0, 4)) { renderNode(t, 0, 0); console.log(""); }
  console.log("tip: node毎の木は  --fn NAME  で。--min TK で枝の閾値。");
}
