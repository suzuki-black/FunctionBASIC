// 再帰下降パーサ。docs/03 §3.2-3.5
// トークン列 → AST ＋ 診断（複数エラー収集／panic-mode 回復）。
// ネストは自由に許可（ブロック本体は statement を再帰）。BREAK/CONTINUE はループスタックで検査。
import type { Token, TokenKind } from "../lexer/token.ts";
import type { Diagnostic, DiagParams } from "../core/diagnostics.ts";
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
  OnTarget,
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
  let strict = false; // STRICT ディレクティブ

  const cur = (): Token => tokens[p];
  const peek = (o = 1): Token => tokens[p + o] ?? tokens[tokens.length - 1];
  const atEof = (): boolean => cur().kind === "EOF";
  const advance = (): Token => tokens[p++];
  const checkKind = (k: TokenKind): boolean => cur().kind === k;
  const checkKw = (v: string): boolean =>
    cur().kind === "KEYWORD" && cur().value === v;
  const checkOp = (v: string): boolean => cur().kind === "OP" && cur().value === v;
  const report = (key: string, pos: Position, params: DiagParams = {}): void => {
    diagnostics.push(error(key, pos, params));
  };
  const expectOp = (v: string, ctx: string): boolean => {
    if (checkOp(v)) {
      advance();
      return true;
    }
    report("E_SYNTAX_EXPECT", cur().pos, { ctx, v });
    return false;
  };
  const expectKw = (v: string, ctx: string): boolean => {
    if (checkKw(v)) {
      advance();
      return true;
    }
    report("E_SYNTAX_EXPECT", cur().pos, { ctx, v });
    return false;
  };
  const expectIdent = (ctx: string): string => {
    if (checkKind("IDENT")) return advance().value;
    report("E_SYNTAX_IDENT", cur().pos, { ctx });
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
    // 図形命令の相対座標 STEP(dx,dy)。STEP は FOR 用キーワードだが、式中（LINE/PSET の
    // 座標）では組込関数 STEP として素通しする（BUILTIN_FUNCTIONS に登録済み＝改名されない）。
    if (t.kind === "IDENT" || (t.kind === "KEYWORD" && t.value === "STEP")) {
      const name = advance().value;
      if (checkOp("(")) {
        const args = parseArgList();
        // 式中の name(args) は CallExpr（配列なら解決時に ArrayRef へ）
        return { type: "CallExpr", name, args };
      }
      return { type: "Var", name };
    }
    report("E_SYNTAX_EXPR", t.pos, { kind: t.kind, v: t.value });
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
      report("E_SYNTAX_EOL", cur().pos, { ctx });
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
    else report("E_SYNTAX_INCLUDE_PATH", cur().pos);
    return { type: "Include", path, pos };
  };

  const parseReturn = (pos: Position): Stmt => {
    advance(); // RETURN
    if (funcDepth === 0)
      report("E_RETURN_OUTSIDE_FUNCTION", pos);
    if (checkKind("NEWLINE") || checkKind("EOF") || checkKind("COMMENT"))
      return { type: "Return", pos };
    return { type: "Return", expr: parseExpr(), pos };
  };

  const parseBuiltinStmt = (pos: Position): Stmt => {
    const name = advance().value;
    const cmd = name.toUpperCase();
    const parts: BuiltinPart[] = [];
    // DATA は項を式として解釈せず生テキストで取り込む（DATA * / DATA "a,b" / 任意リテラル）。
    if (cmd === "DATA") {
      let raw = "";
      let prevEnd = -1;
      let prevLine = -1;
      while (!atEof() && !checkKind("NEWLINE") && !checkKind("COMMENT") && !checkOp(":")) {
        const tk = cur();
        if (prevLine === tk.pos.line && prevEnd >= 0 && tk.pos.column > prevEnd) {
          raw += " ".repeat(tk.pos.column - prevEnd); // 同一行の空白を復元（"HELLO WORLD" 等）
        }
        raw += tk.raw;
        prevEnd = tk.pos.column + tk.raw.length;
        prevLine = tk.pos.line;
        advance();
      }
      return { type: "Builtin", name, parts: raw.length ? [{ kind: "word", word: " " + raw }] : [], pos };
    }
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
        (cmd === "CALL" || cmd.startsWith("_")) &&
        checkKind("IDENT") &&
        parts.every((p) => p.kind === "word")
      ) {
        // CALL <拡張命令名> … の拡張命令名は改名しない。複数語の命令名
        // （CALL VOICE COPY / CALL COPY PCM / CALL MK VOICE 等）に対応するため、
        // 命令名の語が連続する間（先頭からの IDENT の連なり）を語として取り込む。
        // 拡張は機種/カートリッジ依存で開くため、表に無くても名前を保持する。
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
    // RESTORE は引数なしのみ。構造化BASICには行番号が無いので RESTORE <行番号> は不可。
    if (cmd === "RESTORE" && parts.some((p) => p.kind === "expr")) {
      report("E_RESTORE_LINE", pos);
    }
    // DEFINT/DEFSNG/DEFDBL/DEFSTR は不可（変数は2文字名へ改名されるため先頭文字
    // ベースの型宣言が効かない）。型はサフィックス % / ! / # / $ で指定する。
    if (cmd === "DEFINT" || cmd === "DEFSNG" || cmd === "DEFDBL" || cmd === "DEFSTR") {
      report("E_DEF_UNSUPPORTED", pos, { kind: cmd });
    }
    // RESUME は RESUME / RESUME NEXT / RESUME 0 のみ。行番号は不可。
    if (
      cmd === "RESUME" &&
      parts.some((p) => p.kind === "expr" && !(p.expr.type === "Num" && p.expr.value === 0))
    ) {
      report("E_RESUME_LINE", pos);
    }
    return { type: "Builtin", name, parts, pos };
  };

  // 終端キーワード判定。"END" は END IF / END FUNCTION のみ終端とし、
  // 裸の END（プログラム終了文）はブロック内の文として扱う（終端にしない）。
  const atTerminator = (t: string): boolean => {
    if (!checkKw(t)) return false;
    if (t === "END") return peek().kind === "KEYWORD" && (peek().value === "IF" || peek().value === "FUNCTION");
    return true;
  };
  const parseBlockBody = (terminators: string[]): Stmt[] => {
    const body: Stmt[] = [];
    skipNewlines();
    while (!atEof() && !terminators.some(atTerminator)) {
      if (checkKw("FUNCTION")) {
        report("E_NESTED_FUNCTION", cur().pos);
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

  // ON SPRITE GOSUB fn / ON INTERVAL=n GOSUB fn / ON KEY GOSUB f1,f2 /
  // ON ERROR GOTO fn / ON <式> GOTO|GOSUB f1,f2…（飛び先は原則ユーザ関数名）
  const ON_EVENTS = new Set(["SPRITE", "KEY", "STRIG", "STOP", "INTERVAL", "ERROR"]);
  const parseOn = (pos: Position): Stmt => {
    advance(); // ON
    let event = "";
    let arg: Expr | undefined;
    if (checkKind("IDENT") && ON_EVENTS.has(cur().value)) {
      event = advance().value;
      if (event === "INTERVAL") {
        expectOp("=", "ON INTERVAL");
        arg = parseExpr();
      }
    } else {
      arg = parseExpr(); // 計算分岐 ON <式> GOTO/GOSUB
    }
    // 分岐種別（GOTO/GOSUB は字句上は IDENT）
    let dispatch: "GOTO" | "GOSUB" = "GOSUB";
    if (checkKind("IDENT") && (cur().value === "GOTO" || cur().value === "GOSUB")) {
      dispatch = advance().value as "GOTO" | "GOSUB";
    } else {
      report("E_SYNTAX_EXPECT", cur().pos, { ctx: "ON", v: "GOSUB" });
    }
    // 飛び先リスト（関数名 or 数値リテラル）
    const targets: OnTarget[] = [];
    const one = (): void => {
      if (checkKind("IDENT")) targets.push({ fn: advance().value });
      else if (checkKind("NUMBER")) {
        // 飛び先の数値は ON ERROR GOTO 0（無効化）の 0 だけ許可。行番号は不可。
        const v = advance().value;
        if (v === "0") targets.push({ lit: v });
        else report("E_ON_LINE_TARGET", cur().pos);
      } else report("E_SYNTAX_IDENT", cur().pos, { ctx: dispatch });
    };
    one();
    while (checkOp(",")) {
      advance();
      one();
    }
    return { type: "On", event, arg, dispatch, targets, pos };
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
        case "STRICT": {
          // 厳格モード宣言（構造化専用・MSX出力なし）。フラグを立てて文は生成しない。
          advance();
          strict = true;
          endOfStmt("STRICT");
          return null;
        }
        case "IF":
          return parseIf(pos);
        case "FOR":
          return parseFor(pos);
        case "WHILE":
          return parseWhile(pos);
        case "END": {
          // 裸の END（プログラム終了）。END IF / END FUNCTION は parseBlockBody が
          // 終端として先に止めるため、ここに来る END は単独文。
          advance();
          const s: Stmt = { type: "Builtin", name: "END", parts: [], pos };
          endOfStmt("END");
          return s;
        }
        case "ON": {
          const s = parseOn(pos);
          endOfStmt("ON");
          return s;
        }
        case "RETURN": {
          const s = parseReturn(pos);
          endOfStmt("RETURN");
          return s;
        }
        case "BREAK": {
          advance();
          const top = loopStack[loopStack.length - 1];
          if (!top)
            report("E_BREAK_OUTSIDE_LOOP", pos);
          endOfStmt("BREAK");
          return { type: "Break", enclosingLoopId: top, pos };
        }
        case "CONTINUE": {
          advance();
          const top = loopStack[loopStack.length - 1];
          if (!top)
            report("E_CONTINUE_OUTSIDE_LOOP", pos);
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
          report("E_SYNTAX_UNEXPECTED_KW", pos, { v: t.value });
          synchronize();
          return null;
      }
    }
    if (t.kind === "IDENT") {
      // 組み込み文、または '_' 始まりの拡張ステートメント短縮形（_MUSIC = CALL MUSIC）。
      if (isBuiltinStatement(t.value) || t.value.startsWith("_")) {
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

    report("E_SYNTAX_STMT", pos, { kind: t.kind, v: t.value });
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
  program.strict = strict;

  return { program, diagnostics };
}
