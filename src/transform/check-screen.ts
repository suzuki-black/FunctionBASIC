// SCREEN まわりの「静的に確実に分かる落とし穴」だけを警告するパス（コード生成は一切変えない）。
// lowerSprite より前に走らせる（SpriteDef ノードがまだ存在する段階で見たいため）。
//
// 一次資料（MSX-BASIC 仕様）に基づく2件だけを、誤検知ほぼゼロの素直なケースに限って検出する:
//
//  検出1 W_SPRITE_BEFORE_SCREEN:
//    SCREEN はスプライトのパターンテーブルを初期化する。トップレベルの実行順で SPRITE 定義が
//    後続の SCREEN より前にあると、その SPRITE は最初の SCREEN で消えて表示されない。
//    「トップレベルで SPRITE 定義の後に SCREEN がある」＝実行順が確定していて必ず消える場合だけ警告。
//    （関数をまたぐ SCREEN 呼び直し等の流れ依存ケースは、誤検知を避けるため対象外。）
//
//  検出2 W_TEXT_IN_BITMAP_SCREEN:
//    SCREEN 2 以上（ビットマップ画面）では素の PRINT / LOCATE の文字は画面に出ない。
//    プログラムの SCREEN モードがすべて数値リテラルで、かつ全てビットマップ（>=2）のときに限り、
//    素の PRINT があれば警告（テキスト画面 0/1 が混ざる／モードが変数のときは判定不能＝出さない）。
import type { Program, Stmt, BuiltinStmt } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { warning } from "../core/diagnostics.ts";

// SCREEN 文の第1引数（モード）を数値リテラルで返す。変数等で確定できなければ undefined。
function screenMode(s: BuiltinStmt): number | undefined {
  let slot = 0;
  for (const p of s.parts) {
    if (p.kind === "sep" && (p.sep === "," || p.sep === ";")) { slot++; continue; }
    if (slot === 0 && p.kind === "expr") return p.expr.type === "Num" ? p.expr.value : undefined;
  }
  return undefined;
}

// 素の PRINT か（PRINT #n では無い）。parts 先頭が word "#" なら PRINT #n（グラフィック文字等）。
function isPlainPrint(s: BuiltinStmt): boolean {
  if (s.name !== "PRINT") return false;
  const first = s.parts[0];
  return !(first && first.kind === "word" && first.word === "#");
}

// 全文（トップレベル＋関数本体、ブロック内も再帰）を実行順に近い形で訪問する。
function walkAll(program: Program, visit: (s: Stmt) => void): void {
  const walk = (ss: Stmt[]) => {
    for (const s of ss) {
      visit(s);
      if (s.type === "If") { walk(s.then); if (s.else) walk(s.else); }
      else if (s.type === "For" || s.type === "While") walk(s.body);
    }
  };
  walk(program.toplevel);
  for (const fn of program.functions) walk(fn.body);
}

export function checkScreen(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // ---- 検出1: トップレベルで SPRITE 定義が後続の SCREEN より前にある ----
  // トップレベルを実行順（ブロック内も順に）でたどり、まだ SCREEN を見ていない間に現れた SPRITE を
  // 候補として貯める。以降で SCREEN が現れたら、その候補は必ず消えるので警告する。
  {
    const pending: Stmt[] = [];
    let done = false;
    const walkTop = (ss: Stmt[]) => {
      for (const s of ss) {
        if (done) return;
        if (s.type === "Sprite") {
          pending.push(s);
        } else if (s.type === "Builtin" && s.name === "SCREEN") {
          for (const sp of pending) diags.push(warning("W_SPRITE_BEFORE_SCREEN", sp.pos, {}));
          done = true; // 最初の SCREEN で確定。以降は検出1の対象外。
          return;
        }
        if (s.type === "If") { walkTop(s.then); if (!done && s.else) walkTop(s.else); }
        else if (s.type === "For" || s.type === "While") walkTop(s.body);
        if (done) return;
      }
    };
    walkTop(program.toplevel);
  }

  // ---- 検出2: ビットマップ SCREEN で素の PRINT ----
  {
    const modes: number[] = [];
    let anyNonLiteral = false;
    let firstPlainPrint: Stmt | undefined;
    walkAll(program, (s) => {
      if (s.type === "Builtin" && s.name === "SCREEN") {
        const m = screenMode(s);
        if (m === undefined) anyNonLiteral = true; else modes.push(m);
      } else if (!firstPlainPrint && s.type === "Builtin" && isPlainPrint(s)) {
        firstPlainPrint = s;
      }
    });
    // モードが全て数値リテラルで確定し、1つ以上あり、全てビットマップ（>=2）のときだけ。
    const allBitmap = modes.length > 0 && modes.every((m) => m >= 2);
    if (allBitmap && !anyNonLiteral && firstPlainPrint) {
      const mode = Math.min(...modes);
      diags.push(warning("W_TEXT_IN_BITMAP_SCREEN", firstPlainPrint.pos, { mode }));
    }
  }

  return diags;
}
