// STRUCT → struct-of-arrays への desugar（AST→AST 前処理パス。lowerSelect の後に走る）。
// フィールドを合成名「インスタンス@フィールド」の通常の変数/配列へ機械展開するだけなので、
// 実行時コストは手書き並行配列と同一（追加RAM・速度ゼロ）。以降のパスは STRUCT/Field を見ない。
import { suffixOf } from "../ast/nodes.ts";
import type { Program, Stmt, Expr, LValue, ArrayDecl } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";

const stripSuffix = (n: string): string => (/[%!#$]$/.test(n) ? n.slice(0, -1) : n);

export function lowerStruct(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const fail = (key: string, pos: any, params: any = {}) => diags.push(error(key, pos, params));

  // 1) STRUCT 型: name → Map<フィールド基底名, 型付き完全名>
  const structs = new Map<string, Map<string, string>>();
  const collectStructs = (ss: Stmt[]): void => {
    for (const s of ss) {
      if (s.type === "Struct") {
        const fm = new Map<string, string>();
        for (const f of s.fields) {
          if (suffixOf(f) === "") { fail("E_STRUCT_FIELD_TYPE", s.pos, { field: f }); continue; }
          fm.set(stripSuffix(f), f);
        }
        structs.set(s.name, fm);
      } else if (s.type === "If") { collectStructs(s.then); if (s.else) collectStructs(s.else); }
      else if (s.type === "For" || s.type === "While") collectStructs(s.body);
    }
  };
  collectStructs(program.toplevel);
  for (const fn of program.functions) collectStructs(fn.body);

  // 2) インスタンス: name → { fields, isArray }（DIM … AS 型 から）
  const instances = new Map<string, { fields: Map<string, string>; isArray: boolean }>();
  const collectInstances = (ss: Stmt[]): void => {
    for (const s of ss) {
      if (s.type === "Dim") {
        for (const d of s.decls) {
          if (!d.asType) continue;
          const fm = structs.get(d.asType);
          if (!fm) { fail("E_STRUCT_UNKNOWN", s.pos, { name: d.asType }); continue; }
          instances.set(d.name, { fields: fm, isArray: d.dims.length > 0 });
        }
      } else if (s.type === "If") { collectInstances(s.then); if (s.else) collectInstances(s.else); }
      else if (s.type === "For" || s.type === "While") collectInstances(s.body);
    }
  };
  collectInstances(program.toplevel);
  for (const fn of program.functions) collectInstances(fn.body);

  // フィールドアクセス → 合成名（base@完全フィールド名）
  const synth = (base: string, field: string, pos: any): { name: string; isArray: boolean } | null => {
    const info = instances.get(base);
    if (!info) { fail("E_STRUCT_NOT_INSTANCE", pos, { name: base, field }); return null; }
    const full = info.fields.get(stripSuffix(field));
    if (!full) { fail("E_STRUCT_FIELD", pos, { struct: base, field }); return null; }
    return { name: `${base}@${full}`, isArray: info.isArray };
  };

  const rwE = (e: Expr): Expr => {
    switch (e.type) {
      case "Field": {
        const sn = synth(e.base, e.field, e.pos);
        if (!sn) return { type: "Num", value: 0, raw: "0" };
        return sn.isArray ? { type: "ArrayRef", name: sn.name, indices: e.indices.map(rwE) } : { type: "Var", name: sn.name };
      }
      case "Bin": return { ...e, left: rwE(e.left), right: rwE(e.right) };
      case "Un": return { ...e, operand: rwE(e.operand) };
      case "Group": return { ...e, items: e.items.map(rwE) };
      case "ArrayRef": return { ...e, indices: e.indices.map(rwE) };
      case "CallExpr": return { ...e, args: e.args.map((a) => ({ ...a, expr: rwE(a.expr) })) };
      default: return e;
    }
  };
  const rwLV = (lv: LValue): LValue => {
    if (lv.type === "Field") {
      const sn = synth(lv.base, lv.field, lv.pos);
      if (!sn) return { type: "Var", name: "__STRUCTERR" };
      return sn.isArray ? { type: "ArrayRef", name: sn.name, indices: lv.indices.map(rwE) } : { type: "Var", name: sn.name };
    }
    if (lv.type === "ArrayRef") return { ...lv, indices: lv.indices.map(rwE) };
    return lv;
  };

  const rwStmts = (ss: Stmt[]): Stmt[] => {
    const out: Stmt[] = [];
    for (const s of ss) {
      switch (s.type) {
        case "Struct": break; // 除去（コンパイル時のみ）
        case "Dim": {
          const decls: ArrayDecl[] = [];
          for (const d of s.decls) {
            if (d.asType) {
              const info = instances.get(d.name);
              if (!info) continue; // エラーは収集時に報告済み
              // 配列インスタンスはフィールドごとに配列 DIM。スカラは DIM 不要。
              if (info.isArray) for (const full of info.fields.values()) decls.push({ name: `${d.name}@${full}`, dims: d.dims.map(rwE) });
            } else decls.push({ ...d, dims: d.dims.map(rwE) });
          }
          if (decls.length) out.push({ ...s, decls });
          break;
        }
        case "Global": {
          const names: string[] = [];
          for (const n of s.names) {
            const info = instances.get(n);
            if (info) for (const full of info.fields.values()) names.push(`${n}@${full}`); // インスタンス→全フィールド
            else names.push(n);
          }
          out.push({ ...s, names });
          break;
        }
        case "Let": out.push({ ...s, target: rwLV(s.target), expr: rwE(s.expr) }); break;
        case "Const": out.push({ ...s, expr: rwE(s.expr) }); break;
        case "Return": out.push(s.expr ? { ...s, expr: rwE(s.expr) } : s); break;
        case "Call": out.push({ ...s, call: { ...s.call, args: s.call.args.map((a) => ({ ...a, expr: rwE(a.expr) })) } }); break;
        case "Builtin": out.push({ ...s, parts: s.parts.map((p) => (p.kind === "expr" ? { kind: "expr", expr: rwE(p.expr) } : p)) }); break;
        case "On": out.push(s.arg ? { ...s, arg: rwE(s.arg) } : s); break;
        case "If": out.push({ ...s, cond: rwE(s.cond), then: rwStmts(s.then), else: s.else ? rwStmts(s.else) : undefined }); break;
        case "For": out.push({ ...s, from: rwE(s.from), to: rwE(s.to), step: s.step ? rwE(s.step) : undefined, body: rwStmts(s.body) }); break;
        case "While": out.push({ ...s, cond: rwE(s.cond), body: rwStmts(s.body) }); break;
        case "ReadInto": out.push({ ...s, targets: s.targets.map(rwLV) }); break;
        default: out.push(s);
      }
    }
    return out;
  };

  program.toplevel = rwStmts(program.toplevel);
  for (const fn of program.functions) fn.body = rwStmts(fn.body);
  return diags;
}
