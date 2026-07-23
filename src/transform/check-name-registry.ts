// ユーザー定義名レジストリ（クロス種別の名前衝突検査）。
// FUNCTION / MACRO / STRUCT型名 / CONST(トップレベル) / DATASET / SPRITE の名前が「異なる種別で
// 同名」になっていないかを一貫して検査し、E_NAME_COLLISION を報告する。
//
// 役割分担:
//  - 同種の重複（FUNCTION×FUNCTION, STRUCT×STRUCT, CONST×CONST 等）は各既存チェック
//    （E_DUP_FUNCTION / E_STRUCT_DUP / E_DUP_CONST …）が担当。ここでは扱わない。
//  - CONST は「同基底・別サフィックス」（CONST N% と CONST N!）が有効なので、基底名ごとに
//    1 件へ畳んで 1 種別（CONST）として扱う。
//  - 関数ローカルの CONST はスコープが別（意図的シャドウ）なので対象外＝トップレベルのみ収集。
//
// desugar パス（expandMacros / lowerSprite / lowerStruct / inlineConsts）が宣言ノードを取り除く
// 前＝変換パイプラインの最初に走らせること。
import type { Program, Stmt } from "../ast/nodes.ts";
import type { Position } from "../core/position.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";

const stripSuffix = (n: string): string => (/[%!#$]$/.test(n) ? n.slice(0, -1) : n);

type Decl = { base: string; kind: string; pos: Position };

export function checkNameRegistry(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const decls: Decl[] = [];

  for (const fn of program.functions) decls.push({ base: stripSuffix(fn.name), kind: "FUNCTION", pos: fn.pos });
  for (const m of program.macros ?? []) decls.push({ base: stripSuffix(m.name), kind: "MACRO", pos: m.pos });

  // トップレベル宣言（If/For/While のネストも含む）から STRUCT/SPRITE/DATASET/CONST を収集。
  const seenConstBase = new Set<string>();
  const walk = (ss: Stmt[]): void => {
    for (const s of ss) {
      switch (s.type) {
        case "Struct": decls.push({ base: stripSuffix(s.name), kind: "STRUCT", pos: s.pos }); break;
        case "Sprite": decls.push({ base: stripSuffix(s.name), kind: "SPRITE", pos: s.pos }); break;
        case "Dataset": decls.push({ base: stripSuffix(s.name), kind: "DATASET", pos: s.pos }); break;
        case "Const": {
          const b = stripSuffix(s.name);
          // 同基底の複数 CONST（N% / N!）は 1 件に畳む（CONST×CONST は E_DUP_CONST 担当）。
          if (!seenConstBase.has(b)) { seenConstBase.add(b); decls.push({ base: b, kind: "CONST", pos: s.pos }); }
          break;
        }
        case "If": walk(s.then); if (s.else) walk(s.else); break;
        case "For": case "While": walk(s.body); break;
      }
    }
  };
  walk(program.toplevel);

  // 基底名ごとに集約。2 種別以上あれば「クロス種別の衝突」。
  const byBase = new Map<string, Decl[]>();
  for (const d of decls) { const a = byBase.get(d.base) ?? []; a.push(d); byBase.set(d.base, a); }
  for (const group of byBase.values()) {
    if (new Set(group.map((d) => d.kind)).size < 2) continue; // 同種のみ → 既存チェックに委任
    const sorted = [...group].sort((a, b) => (a.pos.line - b.pos.line) || (a.pos.column - b.pos.column));
    const first = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].kind === first.kind) continue; // 同種は既存チェック
      diags.push(error("E_NAME_COLLISION", sorted[i].pos, { name: first.base, kind1: first.kind, kind2: sorted[i].kind }));
    }
  }
  return diags;
}
