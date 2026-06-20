// 再帰下降パーサ。docs/03 §3.2-3.5
// トークン列 → AST ＋ 診断（複数エラー収集／panic-mode 回復）。
// ネストは自由に許可（ブロック本体は statement を再帰）。BREAK/CONTINUE はループスタックで検査。
import type { Token, TokenKind } from "../lexer/token.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";
import type { Position } from "../core/position.ts";
import { isBuiltinStatement, isBuiltinClauseWord } from "../core/builtins.ts";
import { suffixOf } from "../ast/nodes.ts";
import type {
  Program,
  FunctionDef,
  Param,
  Stmt,
  Expr,
  Arg,
  LValue,
  ArrayDecl,
  BuiltinPart,
  IfBlock,
  ForBlock,
  WhileBlock,
} from "../ast/nodes.ts";

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

const COMPARE_OPS = new Set(["=", "<>", "<", ">", "<=", ">="]);

export function parse(tokens: Token[]): ParseResult {
  let p = 0;
  const diagnostics: Diagnostic[] = [];
  const loopStack: string[] = [];
  let funcDepth = 0;
  let loopId = 0;

  const cur = (): Token => tokens[p];
  const peek = (o = 1): Token => tokens[p + o] ?? tokens[tokens.length - 1];
  const atEof = (): boolean => cur().kind === "EOF";
  const advance = (): Token => tokens[p++];
  const checkKind = (k: TokenKind): boolean => cur().kind === k;
  const checkKw = (v: string): boolean =>
    cur().kind === "KEYWORD" && cur().value === v;
  const checkOp = (v: string): boolean => cur().kind === "OP" && cur().value === v;
  const report = (code: string, pos: Position, msg: string): void => {
    diagnostics.push(error(code, pos, msg));
  };
  const expectOp = (v: string, ctx: string): boolean => {
    if (checkOp(v)) {
      advance();
      return true;
    }
    report("E_SYNTAX", cur().pos, `${ctx}: '${v}' が必要です`);
    return false;
  };
  const expectKw = (v: string, ctx: string): boolean => {
    if (checkKw(v)) {
      advance();
      return true;
    }
    report("E_SYNTAX", cur().pos, `${ctx}: '${v}' が必要です`);
    return false;
  };
  const expectIdent = (ctx: string): string => {
    if (checkKind("IDENT")) return advance().value;
    report("E_SYNTAX", cur().pos, `${ctx}: 識別子が必要です`);
    return "";
  };
  const skipNewlines = (): void => {
    while (checkKind("NEWLINE")) advance();
  };
  const synchronize = (): void => {
    while (
      !atEof() &&
      !checkKind("NEWLINE") &&
      !checkKw("END") &&
      !checkKw("NEXT") &&
      !checkKw("WEND") &&
      !checkKw("ELSE")
    )
      advance();
    if (checkKind("NEWLINE")) advance();
  };
  const newLoopId = (): string => "L" + ++loopId;

  // 数値変換
  const toNumber = (raw: string): number => {
    const u = raw.toUpperCase();
    if (u.startsWith("&H")) return parseInt(u.slice(2), 16);
    if (u.startsWith("&O")) return parseInt(u.slice(2), 8);
    if (u.startsWith("&B")) return parseInt(u.slice(2), 2);
    return parseFloat(u.replace("D", "E")); // 倍精度指数 D → E
  };

  // ---- 式 ----
  const parseExpr = (): Expr => parseBin(parseUnary(), 0);

  // 優先順位（loose→tight）: XOR < OR < AND < (compare) < +- < MOD < \ < */ 。NOT は parseUnary。^ は parseUnary 内。
  const binLevel = (): number => {
    if (checkKw("XOR")) return 1;
    if (checkKw("OR")) return 2;
    if (checkKw("AND")) return 3;
    if (cur().kind === "OP" && COMPARE_OPS.has(cur().value)) return 4;
    if (checkOp("+") || checkOp("-")) return 5;
    if (checkKw("MOD")) return 6;
    if (checkOp("\\")) return 7;
    if (checkOp("*") || checkOp("/")) return 8;
    return -1;
  };
  const parseBin = (left: Expr, minLevel: number): Expr => {
    for (;;) {
      const lv = binLevel();
      if (lv < 0 || lv < minLevel) return left;
      const op = advance().value;
      let right = parseUnary();
      // 左結合: 次が同レベル以上なら現在の演算子で確定し、より高いレベルを先に束ねる
      for (;;) {
        const lv2 = binLevel();
        if (lv2 > lv) right = parseBin(right, lv + 1);
        else break;
      }
      left = { type: "Bin", op, left, right };
    }
  };

  const parseUnary = (): Expr => {
    if (checkKw("NOT")) {
      advance();
      return { type: "Un", op: "NOT", operand: parseUnary() };
    }
    if (checkOp("-") || checkOp("+")) {
      const op = advance().value;
      return { type: "Un", op, operand: parseUnary() };
    }
    return parsePow();
  };

  const parsePow = (): Expr => {
    const base = parsePrimary();
    if (checkOp("^")) {
      advance();
      const exp = parseUnary(); // ^ は unary より強いが右オペランドの単項も許す
      return { type: "Bin", op: "^", left: base, right: exp };
    }
    return base;
  };

  const parsePrimary = (): Expr => {
    const t = cur();
    if (t.kind === "NUMBER") {
      advance();
      return { type: "Num", value: toNumber(t.value), raw: t.raw };
    }
    if (t.kind === "STRING") {
      advance();
      return { type: "Str", value: t.value };
    }
    if (checkOp("(")) {
      advance();
      // 括弧内はカンマ区切りも許す: 優先順位の `(a+b)` も座標タプル `(x, y)` も Group に。
      const items: Expr[] = [parseExpr()];
      while (checkOp(",")) {
        advance();
        items.push(parseExpr());
      }
      expectOp(")", "括弧");
      return { type: "Group", items };
    }
    if (t.kind === "IDENT") {
      const name = advance().value;
      if (checkOp("(")) {
        const args = parseArgList();
        // 式中の name(args) は CallExpr（配列なら解決時に ArrayRef へ）
        return { type: "CallExpr", name, args };
      }
      return { type: "Var", name };
    }
    report("E_SYNTAX", t.pos, `式が必要です（${t.kind} '${t.value}'）`);
    return { type: "Num", value: 0, raw: "0" };
  };

  const parseArgList = (): Arg[] => {
    expectOp("(", "引数");
    const args: Arg[] = [];
    if (!checkOp(")")) {
      args.push(parseArg());
      while (checkOp(",")) {
        advance();
        args.push(parseArg());
      }
    }
    expectOp(")", "引数");
    return args;
  };

  const parseArg = (): Arg => {
    if (checkKw("REF")) {
      advance();
      return { byRef: true, expr: parsePrimary() };
    }
    return { byRef: false, expr: parseExpr() };
  };

  // ---- 文 ----
  const endOfStmt = (ctx: string): void => {
    if (checkKind("COMMENT")) advance(); // 行末インラインコメントは今は読み飛ばし
    if (checkKind("NEWLINE")) advance();
    else if (!atEof()) {
      report("E_SYNTAX", cur().pos, `${ctx}: 行末が必要です`);
      synchronize();
    }
  };

  const parseLValue = (): LValue => {
    const name = expectIdent("代入先");
    if (checkOp("(")) {
      const args = parseArgList();
      return { type: "ArrayRef", name, indices: args.map((a) => a.expr) };
    }
    return { type: "Var", name };
  };

  const parseAssignment = (hadLet: boolean, startPos: Position): Stmt => {
    const target = parseLValue();
    expectOp("=", "代入");
    const expr = parseExpr();
    return { type: "Let", target, expr, hadLet, pos: startPos };
  };

  const parseDim = (pos: Position): Stmt => {
    advance(); // DIM
    const decls: ArrayDecl[] = [];
    const one = (): ArrayDecl => {
      const name = expectIdent("DIM");
      const args = parseArgList();
      return { name, dims: args.map((a) => a.expr) };
    };
    decls.push(one());
    while (checkOp(",")) {
      advance();
      decls.push(one());
    }
    return { type: "Dim", decls, pos };
  };

  const parseGlobal = (pos: Position): Stmt => {
    advance(); // GLOBAL
    const names: string[] = [expectIdent("GLOBAL")];
    while (checkOp(",")) {
      advance();
      names.push(expectIdent("GLOBAL"));
    }
    return { type: "Global", names, pos };
  };

  const parseInclude = (pos: Position): Stmt => {
    advance(); // INCLUDE
    let path = "";
    if (checkKind("STRING")) path = advance().value;
    else report("E_SYNTAX", cur().pos, "INCLUDE: 文字列パスが必要です");
    return { type: "Include", path, pos };
  };

  const parseReturn = (pos: Position): Stmt => {
    advance(); // RETURN
    if (funcDepth === 0)
      report("E_RETURN_OUTSIDE_FUNCTION", pos, "RETURN は関数の中でのみ使用できます");
    if (checkKind("NEWLINE") || checkKind("EOF") || checkKind("COMMENT"))
      return { type: "Return", pos };
    return { type: "Return", expr: parseExpr(), pos };
  };

  const parseBuiltinStmt = (pos: Position): Stmt => {
    const name = advance().value;
    const cmd = name.toUpperCase();
    const parts: BuiltinPart[] = [];
    while (
      !atEof() &&
      !checkKind("NEWLINE") &&
      !checkKind("COMMENT") &&
      !checkOp(":")
    ) {
      const last = parts[parts.length - 1];
      // 節キーワードを「語」として素通しするのは曖昧でない文脈に限定する。
      // 命令ごとに「どの語が」その位置で許されるかまで絞る（PAGE/TIME/B 等は
      // 変数名にも使えるため、PRINT PAGE のような通常変数は改名する必要がある）:
      //  - SET/GET 命令の直後 … その節キーワード全般（SET PAGE / GET TIME 等）
      //  - PRINT/LPRINT 命令の直後 … USING のみ（PRINT USING）
      //  - '=' の直後 … NEW/RESTORE（COLOR=NEW / COLOR=RESTORE）
      const w = checkKind("IDENT") ? cur().value.toUpperCase() : "";
      const clauseWordHere =
        w !== "" &&
        isBuiltinClauseWord(w) &&
        ((parts.length === 0 && (cmd === "SET" || cmd === "GET")) ||
          (parts.length === 0 &&
            (cmd === "PRINT" || cmd === "LPRINT") &&
            w === "USING") ||
          (last?.kind === "word" && last.word === "="));
      if (checkOp(";") || checkOp(",")) {
        parts.push({ kind: "sep", sep: advance().value });
      } else if (cur().kind === "KEYWORD" || checkOp("=") || checkOp("#")) {
        // 命令中の節キーワード(COPY ... TO 等)や '='(COLOR=) / '#'(ファイル番号)は
        // 式の開始になり得ないので、そのまま素通しする語として保持する。
        parts.push({ kind: "word", word: advance().value });
      } else if (clauseWordHere) {
        parts.push({ kind: "word", word: advance().value });
      } else if (
        // LINE ...,B / ...,BF の末尾オプション（箱・塗り箱）。B/BF は変数名にも
        // 使えるため、LINE 命令の文末位置に来たときだけキーワードとして扱う。
        cmd === "LINE" &&
        checkKind("IDENT") &&
        (cur().value.toUpperCase() === "B" || cur().value.toUpperCase() === "BF") &&
        (peek().kind === "NEWLINE" ||
          peek().kind === "COMMENT" ||
          peek().kind === "EOF" ||
          (peek().kind === "OP" && peek().value === ":"))
      ) {
        parts.push({ kind: "word", word: advance().value });
      } else {
        const before = p;
        parts.push({ kind: "expr", expr: parseExpr() });
        if (p === before) advance(); // 進行保証（不正トークンで無限ループしない）
      }
    }
    return { type: "Builtin", name, parts, pos };
  };

  const parseBlockBody = (terminators: string[]): Stmt[] => {
    const body: Stmt[] = [];
    skipNewlines();
    while (!atEof() && !terminators.some((t) => checkKw(t))) {
      if (checkKw("FUNCTION")) {
        report("E_NESTED_FUNCTION", cur().pos, "FUNCTION の中に FUNCTION は定義できません");
        synchronize();
        skipNewlines();
        continue;
      }
      const before = p;
      const s = parseStatement();
      if (s) body.push(s);
      else if (p === before) advance(); // 進捗保証（無限ループ防止）
      skipNewlines();
    }
    return body;
  };

  const parseIf = (pos: Position): IfBlock => {
    advance(); // IF
    const cond = parseExpr();
    expectKw("THEN", "IF");
    // ブロックIFのみ対応（1行IFはネスト許可後は不要、ただし将来拡張余地）
    if (checkKind("NEWLINE")) advance();
    const thenBody = parseBlockBody(["ELSE", "END"]);
    let elseBody: Stmt[] | undefined;
    if (checkKw("ELSE")) {
      advance();
      if (checkKind("NEWLINE")) advance();
      elseBody = parseBlockBody(["END"]);
    }
    expectKw("END", "IF");
    expectKw("IF", "IF");
    return { type: "If", cond, then: thenBody, else: elseBody, pos };
  };

  const parseFor = (pos: Position): ForBlock => {
    advance(); // FOR
    const varName = expectIdent("FOR");
    expectOp("=", "FOR");
    const from = parseExpr();
    expectKw("TO", "FOR");
    const to = parseExpr();
    let step: Expr | undefined;
    if (checkKw("STEP")) {
      advance();
      step = parseExpr();
    }
    const id = newLoopId();
    loopStack.push(id);
    const body = parseBlockBody(["NEXT"]);
    loopStack.pop();
    expectKw("NEXT", "FOR");
    if (checkKind("IDENT")) advance(); // NEXT I の変数名（任意）
    return { type: "For", varName, from, to, step, body, loopId: id, pos };
  };

  const parseWhile = (pos: Position): WhileBlock => {
    advance(); // WHILE
    const cond = parseExpr();
    const id = newLoopId();
    loopStack.push(id);
    const body = parseBlockBody(["WEND"]);
    loopStack.pop();
    expectKw("WEND", "WHILE");
    return { type: "While", cond, body, loopId: id, pos };
  };

  const parseStatement = (): Stmt | null => {
    const t = cur();
    const pos = t.pos;

    if (t.kind === "COMMENT") {
      advance();
      const s: Stmt = { type: "Comment", text: t.value, pos };
      endOfStmt("コメント");
      return s;
    }
    if (t.kind === "KEYWORD") {
      switch (t.value) {
        case "IF":
          return parseIf(pos);
        case "FOR":
          return parseFor(pos);
        case "WHILE":
          return parseWhile(pos);
        case "RETURN": {
          const s = parseReturn(pos);
          endOfStmt("RETURN");
          return s;
        }
        case "BREAK": {
          advance();
          const top = loopStack[loopStack.length - 1];
          if (!top)
            report("E_BREAK_OUTSIDE_LOOP", pos, "BREAK はループの内側でのみ使用できます");
          endOfStmt("BREAK");
          return { type: "Break", enclosingLoopId: top, pos };
        }
        case "CONTINUE": {
          advance();
          const top = loopStack[loopStack.length - 1];
          if (!top)
            report("E_CONTINUE_OUTSIDE_LOOP", pos, "CONTINUE はループの内側でのみ使用できます");
          endOfStmt("CONTINUE");
          return { type: "Continue", enclosingLoopId: top, pos };
        }
        case "LET": {
          advance();
          const s = parseAssignment(true, pos);
          endOfStmt("代入");
          return s;
        }
        case "DIM": {
          const s = parseDim(pos);
          endOfStmt("DIM");
          return s;
        }
        case "GLOBAL": {
          const s = parseGlobal(pos);
          endOfStmt("GLOBAL");
          return s;
        }
        case "INCLUDE": {
          const s = parseInclude(pos);
          endOfStmt("INCLUDE");
          return s;
        }
        default:
          report("E_SYNTAX", pos, `予期しないキーワード '${t.value}'`);
          synchronize();
          return null;
      }
    }
    if (t.kind === "IDENT") {
      if (isBuiltinStatement(t.value)) {
        const s = parseBuiltinStmt(pos);
        endOfStmt(t.value);
        return s;
      }
      // 代入 or 呼び出し
      const name = advance().value;
      if (checkOp("(")) {
        const args = parseArgList();
        if (checkOp("=")) {
          advance();
          const expr = parseExpr();
          const s: Stmt = {
            type: "Let",
            target: { type: "ArrayRef", name, indices: args.map((a) => a.expr) },
            expr,
            hadLet: false,
            pos,
          };
          endOfStmt("代入");
          return s;
        }
        const s: Stmt = { type: "Call", call: { type: "CallExpr", name, args }, pos };
        endOfStmt("呼び出し");
        return s;
      }
      if (checkOp("=")) {
        advance();
        const expr = parseExpr();
        const s: Stmt = {
          type: "Let",
          target: { type: "Var", name },
          expr,
          hadLet: false,
          pos,
        };
        endOfStmt("代入");
        return s;
      }
      // 引数なし呼び出し
      const s: Stmt = { type: "Call", call: { type: "CallExpr", name, args: [] }, pos };
      endOfStmt("呼び出し");
      return s;
    }

    report("E_SYNTAX", pos, `文が必要です（${t.kind} '${t.value}'）`);
    synchronize();
    return null;
  };

  const parseFunctionDef = (): FunctionDef => {
    const pos = cur().pos;
    advance(); // FUNCTION
    const rawName = expectIdent("FUNCTION");
    const retSuffix = suffixOf(rawName);
    const name = retSuffix ? rawName.slice(0, -1) : rawName;
    expectOp("(", "FUNCTION");
    const params: Param[] = [];
    if (!checkOp(")")) {
      const one = (): Param => {
        const byRef = checkKw("REF");
        if (byRef) advance();
        return { name: expectIdent("引数"), byRef };
      };
      params.push(one());
      while (checkOp(",")) {
        advance();
        params.push(one());
      }
    }
    expectOp(")", "FUNCTION");
    if (checkKind("NEWLINE")) advance();
    funcDepth++;
    const body = parseBlockBody(["END"]);
    funcDepth--;
    expectKw("END", "FUNCTION");
    expectKw("FUNCTION", "FUNCTION");
    return { type: "FunctionDef", name, retSuffix, params, body, pos };
  };

  // ---- プログラム ----
  const program: Program = {
    type: "Program",
    functions: [],
    toplevel: [],
    includes: [],
  };
  skipNewlines();
  while (!atEof()) {
    if (checkKw("FUNCTION")) {
      program.functions.push(parseFunctionDef());
    } else {
      const before = p;
      const s = parseStatement();
      if (s) {
        if (s.type === "Include") program.includes.push(s);
        else program.toplevel.push(s);
      } else if (p === before) advance(); // 進捗保証（無限ループ防止）
    }
    skipNewlines();
  }

  return { program, diagnostics };
}
