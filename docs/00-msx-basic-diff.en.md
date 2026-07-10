# 00. MSX-BASIC → Structured BASIC diff guide

> 🌐 日本語版: [00-msx-basic-diff.md](00-msx-basic-diff.md)
>
> **What this is.** A **diff cheat-sheet** that works for two readers at once: someone who
> already knows MSX-BASIC (read only "what changed" and start writing), and an AI doing
> vibe-coding (read it and generate correct Structured BASIC). It is not a copy of the spec —
> every claim was **checked against the implementation (lexer / parser / transformer) and
> `examples/`**. Full spec: [01-language-spec.md](01-language-spec.md); built-ins:
> [12-builtins.md](12-builtins.md).

Structured BASIC (`.msxb`) is a **front-end language that generates MSX-BASIC**. You write the
source for humans; the transpiler emits line-numbered, two-character-variable MSX-BASIC.
**Runtime semantics stay pure MSX-BASIC** (operators, truth values, built-in commands are
unchanged). Only *how you write it* differs.

---

## 0. 30-second summary

| Aspect | MSX-BASIC | Structured BASIC |
| --- | --- | --- |
| Control flow | line numbers + `GOTO`/`GOSUB` | `FUNCTION` / block `IF`·`FOR`·`WHILE` (freely nested) / `BREAK`·`CONTINUE` |
| Subroutines | `GOSUB <line>` | `FUNCTION name(...)` + `RETURN value` (early return OK, top-level only, **no recursion**) |
| Variable scope | everything global | **local by default + `GLOBAL` to share** (PHP-style) |
| Variable names | first 2 chars only, no `_` | **any length, `_` allowed** (`PLAYER_X%`) → auto-compressed to a unique 2-char name |
| Constants | none (use variables) | `CONST` (inlined to a literal at compile time — no variable emitted) |
| Type | single-precision default; `DEFxxx` changes it | name suffix (`% ! # $`); optional `STRICT` = static type checking |
| One statement / line | `:` multi-statement OK | **one statement per line only (`:` is forbidden in source)** |
| IF | single-line `IF … THEN <stmt>` OK | **block `IF … THEN` … `END IF` only** (no single-line IF) |
| Machine code | `DATA` + `POKE` + `USR` | `ASM … END ASM` (inline Z80) |
| Split files | none | `INCLUDE "..."` |
| Comments | `'` / `REM` | `'` / `REM` (same) |

**Golden rules (follow these and it runs):** ① don't write line numbers ② don't use `GOTO`
③ one statement per line (`:` forbidden) ④ always close an IF with `END IF` ⑤ to use a global
inside a function, declare `GLOBAL name` at its top ⑥ `CONST` is usable anywhere with no
declaration.

---

## 1. What's gone (using it is an error)

The transpiler **never silently mis-converts — it always reports an error.** Replace left with right.

| Not available (MSX-BASIC) | Error | Structured replacement |
| --- | --- | --- |
| line numbers (`10 PRINT`) | — | don't write them; statements run in order |
| `GOTO <line>` / `GOSUB <line>` | `E_GOTO` etc. | `FUNCTION` · `IF`/`FOR`/`WHILE` · `BREAK`/`CONTINUE` |
| `ON x GOTO/GOSUB <line>` | `E_ON_LINE_TARGET` | `ON x GOTO/GOSUB <function name>` (handler takes **no args**, `E_HANDLER_PARAMS`) |
| `ON ERROR GOTO <line>` | — | `ON ERROR GOTO <function>`; disable with `ON ERROR GOTO 0` |
| `RESUME <line>` | `E_RESUME_LINE` | `RESUME` / `RESUME NEXT` / `RESUME 0` |
| `RESTORE <line>` | `E_RESTORE_LINE` | argument-less `RESTORE` (to the first `DATA`) |
| `DEFINT/DEFSNG/DEFDBL/DEFSTR` | `E_DEF_UNSUPPORTED` | name suffix `% ! # $` (e.g. `COUNT%`, `LABEL$`) |
| `DEF FN` / `DEF USR` | — | `FUNCTION` (for machine code use `ASM` or `POKE` the USR vector) |
| direct-mode commands `RUN` `LIST` `AUTO` `RENUM` `NEW` `CONT` `DELETE` `EDIT` | — | not program statements (interactive only) |
| single-line `IF … THEN <stmt>` (no `END IF`) | `E_SYNTAX` | block `IF … THEN` … `END IF` |
| `:` multi-statement (`A=1 : B=2`) | `E_SYNTAX` | split onto separate lines |

> ⚠ **`:` and single-line IF are always invalid in source** (for assignment or PRINT alike).
> But the **generated MSX-BASIC does contain `:`** (e.g. `C%=10: GOSUB 1000`) — that's the
> transpiler's output; you never write it.

---

## 2. What changed

### 2.1 Variable scope (local by default + `GLOBAL`)

MSX-BASIC makes every variable global. Structured BASIC makes **variables inside a function
local by default**; declare only the ones you want to share with `GLOBAL name` at the top of the
function (**identical to PHP's `global $x;`**).

```basic
GLOBAL SCORE%                 ' top level = where a global lives
DIM MAP%(31)                  ' a top-level DIM = a global array

FUNCTION ADD_SCORE%(POINTS%)
    GLOBAL SCORE%             ' declare intent to use this global (for an array: GLOBAL MAP%, no parens)
    SCORE% = SCORE% + POINTS%
    RETURN SCORE%
END FUNCTION

FUNCTION RENDER()            ' a function name cannot collide with a built-in (DRAW/SWAP etc. are out — §5)
    FOR I% = 0 TO 31          ' I% is undeclared = local (won't clash with other functions)
        PRINT I%
    NEXT I%
    RETURN 0
END FUNCTION
```

- An undeclared name is **always local**. A function can't see a global unless it's declared
  (prevents accidental sharing).
- Arrays are the same. To use a global array in a function, declare `GLOBAL A` (no parens).

### 2.2 Variable names (any length, `_` allowed → auto-compressed to 2 chars)

MSX-BASIC only distinguishes the first two characters of a name (`COUNT` and `COUNTER` collide)
and forbids `_`. Structured BASIC **allows long descriptive names with underscores** and assigns
each a **unique two-character MSX name** at transpile time. **Zero runtime/memory cost.**

- The pool is per-type (`% ! # $`, ~960 each, reserved words excluded). Locals whose lifetimes
  don't overlap reuse names.
- Running out gives `E_VAR_NAMES_EXHAUSTED`. `INCLUDE` spends from the shared pool.
- → So make **globals and constants especially descriptive** (`SCROLL_OFFSET%`,
  `NAME_TABLE_BASE%`).

### 2.3 Other

- **`LET` is optional** (`X = 1` and `LET X = 1` are the same).
- **Functions expand to `GOSUB`**: a call puts arguments into dedicated variables, does `GOSUB`,
  then copies the return-value variable right after ([§6](#6-before--after-example)).

---

## 3. What's new

### 3.1 FUNCTION

```basic
FUNCTION name(param list)      ' there is no SUB; write procedures as FUNCTIONs, end with RETURN 0
    ...
    RETURN value               ' allowed anywhere in the function (early return OK)
END FUNCTION
```

- **Top-level only** (no nested functions — `E_NESTED_FUNCTION`).
- **No recursion** (direct or indirect — `E_RECURSION_UNSUPPORTED`).
- The return type is the **function-name suffix**: `FUNCTION ADD%(...)` returns an integer,
  `FUNCTION GREET$(...)` returns a string. No suffix = single-precision.
- **Call with or without the suffix**: `ADD(1,2)` and `ADD%(1,2)` call the same function.
- Built-in commands (`PRINT` `LOCATE` `VPOKE` `MID$` `RND` …) **pass through** unchanged.
  Redefining a built-in name as a user function is rejected (`E_NAME_IS_BUILTIN`). An unknown
  call is `E_UNKNOWN_FUNCTION`.

### 3.2 Blocks and nesting

```basic
IF cond THEN
    ...
ELSE          ' optional
    ...
END IF

FOR I% = a TO b STEP s   ' STEP optional
    ...
NEXT I%       ' the NEXT variable is optional

WHILE cond
    ...
WEND
```

- **IF / FOR / WHILE nest freely** (same or different kinds; the old "no nesting" rule is gone).
- No nesting depth limit (mind the MSX FOR/GOSUB stack in practice).
- Block conditions may be compound with `AND`/`OR` (`WHILE A% < 10 AND B% = 0`).

### 3.3 BREAK / CONTINUE

- `BREAK` = leave the **innermost loop**; `CONTINUE` = next iteration of the innermost loop.
- Usable from inside a nested IF (target is always the innermost loop). Outside a loop:
  `E_BREAK_OUTSIDE_LOOP` / `E_CONTINUE_OUTSIDE_LOOP`.

### 3.4 REF (pass by reference, zero-copy)

```basic
FUNCTION EXCHANGE(REF A%, REF B%)   ' SWAP is a built-in, so it can't be a function name (§5)
    T% = A%
    A% = B%
    B% = T%
    RETURN 0
END FUNCTION
' Call site. Writing REF or not is the same — the definition decides pass-by-ref.
R% = EXCHANGE(X%, Y%)
```

- Default is **by value**. A `REF` parameter is **by reference** (substituted directly with the
  caller's real variable name — no copy, a true reference).
- A `REF` argument must be a **variable name** (an expression/literal gives `E_REF_NOT_VARIABLE`).
  Scalars, numeric/string arrays, multi-dimensional — all fine.
- **Passing an array by value (no REF) is allowed** but copies every element (O(n)) and is heavy.
  Use `REF` when you need speed.

### 3.5 CONST (compile-time constant, inlined)

```basic
CONST MAX_HP% = 100          ' the type suffix is optional (if present, the value's type is checked)
CONST TITLE$ = "READY"
CONST AREA% = 8 * 24         ' constant expressions are folded
```

- **Not a variable**: each use is **replaced by the literal**, generating no MSX variable
  (good for speed and size).
- Therefore **no `GLOBAL` declaration is needed** — reference it from any function without
  declaring.
- **Reassignment is an error** (`E_CONST_ASSIGN`). A non-foldable expression is
  `E_CONST_NOT_CONSTANT`; a type mismatch is `E_CONST_TYPE`; a duplicate name is `E_DUP_CONST`.
- Under `STRICT` the type suffix is required.

### 3.6 STRICT (optional static typing)

Put `STRICT` at the top of the source to enable opt-in static type checking (Rust-style — no
implicit conversion). Off by default.

- **Every variable, array, parameter, `FOR` variable and `CONST` needs a type suffix** (else
  `E_STRICT_UNTYPED`).
- **Assignment, arguments and return values must match exactly.** No implicit conversion
  (`A% = 1.5` or mixing `%` and `#` is `E_TYPE_MISMATCH`). Convert explicitly with
  `CINT`/`CSNG`/`CDBL`/`INT`/`FIX`/`STR$`/`VAL` etc.
- Numeric literals are flexible (`5` fits `%`/`!`/`#`; `1.5` fits `!`/`#`). Operators follow the
  MSX promotion rules; exact-match is enforced at assignment/argument/return boundaries.
- On the Z80 integer (`%`) math is fast — keep game logic in `%`.

### 3.7 ASM (inline Z80)

```basic
ASM
    LD A,42
    CALL &H00A2      ' CHPUT
    RET
END ASM
```

- Assembled into a buffer just below `HIMEM` and run via `DEFUSR`/`USR`.
- `(NAME)` references an `%`-integer BASIC variable (patched once via `VARPTR`). Labels + relative
  jumps (`JR`/`DJNZ`) are supported. **`%` integers only.**
- Details: the ASM docs/implementation and `examples/space-shooter-turbor.msxb`.

### 3.8 INCLUDE (split files)

```basic
INCLUDE "lib/math.msxb"
```

- **Top level only.** Resolved before parsing and merged into **one compilation unit**. The
  namespace is shared across the unit (a duplicate FUNCTION name is `E_DUP_FUNCTION`).
- A cycle is `E_INCLUDE_CYCLE`; a missing file is `E_INCLUDE_NOT_FOUND`. Included files are also
  Shift-JIS.

---

## 4. What stays the same (as MSX-BASIC)

This part **doesn't change**, so your MSX-BASIC knowledge carries over directly.

- **Operators and precedence**: `^` > unary `-` > `* /` > `\` (integer divide) > `MOD` > `+ -`;
  comparison `= <> < > <= >=`; logical `NOT` > `AND` > `OR` > `XOR` (`EQV`/`IMP` too).
- **Truth values**: true = `-1`, false = `0` (`IF A%` means `A% <> 0`).
- **Literals**: decimal, `&H` (hex), `&O` (octal), `&B` (binary). Strings are `"..."`.
- **Arrays are base 0** (`DIM A(10)` = 11 elements, 0..10).
- **Built-in commands/functions pass through** (`PRINT` `LOCATE` `CLS` `VPOKE`/`VPEEK`
  `PEEK`/`POKE` `PUT SPRITE` `SET SCROLL` `SOUND` `STICK` `STRIG` `MID$` `CHR$` `RND` `USR` …).
  Behavior and arguments follow MSX-BASIC.
- **Comments** `'` and `REM` (not uppercased or transformed; kept verbatim).
- **Strings are max 255 bytes** (all MSX versions).

---

## 5. Gotchas & best practices (important)

Traps hit in practice. Follow these when generating code and it won't blow up.

| Symptom / mistake | Cause | Correct way |
| --- | --- | --- |
| `E_SYNTAX` (IF line) | single-line `IF X% > 0 THEN Y% = 1` | use a block IF (`IF …` / newline `Y% = 1` / newline `END IF`) |
| `E_SYNTAX` (`:`) | multiple statements on a line (`A=1 : B=2`) | one statement per line |
| a global reads as 0/undefined in a function | forgot `GLOBAL name` in the function | declare every global used at the function top (arrays too: `GLOBAL A`) |
| `Illegal function call` (runtime) | `STRING$(300,0)` etc. > 255-byte string | keep strings ≤ 255 bytes; long machine code → `ASM` + HIMEM placement |
| `Illegal function call` (`VARPTR`) | `VARPTR` on an unassigned variable | assign it first (`=0` etc.) before `VARPTR` |
| `E_NAME_IS_BUILTIN` | function name equals a built-in (`DRAW` `SWAP` `PLAY` `LINE` …) | rename it (`RENDER`, `EXCHANGE`, …) |
| `E_RECURSION_UNSUPPORTED` | a function calls itself directly/indirectly | flatten to a loop or an explicit stack array |
| `E_REF_NOT_VARIABLE` | passed an expression/literal to `REF` | `REF` takes a variable name only |
| `E_VAR_NAMES_EXHAUSTED` | more than ~960 live variables of one type | localize (split lifetimes so names reuse) / reduce variables |
| `E_STRICT_UNTYPED` | no suffix under `STRICT` | give every variable/param/array/FOR var/CONST a `% ! # $` |
| `E_TYPE_MISMATCH` | mixed types under `STRICT` (`A% = B#`) | convert explicitly with `CINT`/`CSNG`/`CDBL` etc. |

Best practices:
- **One statement per line, block IF** always (`:` and single-line IF are never allowed).
- **Descriptive names for globals and CONSTs** (underscores, no abbreviations) — free, since they
  compress to 2 chars. Mutable shared state = `GLOBAL`, immutable = `CONST`.
- Loop variables and indices as `%` (integer is fast on the Z80).
- End procedures (functions with no return value) with `RETURN 0`.

---

## 6. Before → after example

Structured BASIC (what you write):

```basic
CONST MAX_HP% = 100          ' unused here, so it vanishes after transpile (inlined)
GLOBAL SCORE%

FUNCTION ADD_SCORE%(POINTS%)
    GLOBAL SCORE%
    SCORE% = SCORE% + POINTS%
    RETURN SCORE%
END FUNCTION

SCORE% = 0
FOR ENEMY% = 1 TO 3
    IF ADD_SCORE%(10) >= 20 THEN
        PRINT "BONUS"
    END IF
NEXT ENEMY%
PRINT SCORE%
```

Generated MSX-BASIC (transpiler output; line numbers are added in the final render — MAIN from
100, functions from 1000):

```basic
' === MAIN ===
A%=0                         ' SCORE% -> A%
FOR B%=1 TO 3                ' ENEMY% -> B% (local)
C%=10: GOSUB 1000: E%=D%     ' ADD_SCORE%(10): arg into C% -> GOSUB -> return D% into E%
IF E%>=20 THEN PRINT "BONUS" ' block IF (folded to one line when it's a single statement)
NEXT
PRINT A%
END
' === FUNCTION ADD_SCORE ===
A%=A%+C%                     ' SCORE%(A%) += POINTS%(C%)
D%=A%: RETURN                ' return value into D%, then RETURN
```

Things to notice:
- `CONST MAX_HP%` **does not exist as a variable** (inlined; unused = no trace).
- `GLOBAL SCORE%` → the fixed `A%`. Local `ENEMY%` → `B%`.
- A function call is **arg into a dedicated variable → `GOSUB` → copy the return variable**.
- The output uses `:` (which you never write in source).

---

## 7. Checklist for AI (obey when generating)

Mandatory rules when writing Structured BASIC (`.msxb`):

1. **Never write line numbers. Never use `GOTO`/`GOSUB <line>`.**
2. **One statement per line. Never chain with `:`.**
3. **`IF` is always a block** (`IF cond THEN` / newline … / newline `END IF`). No single-line
   `IF … THEN <stmt>`.
4. **To use a global variable/array inside a function, declare `GLOBAL name` at its top** (arrays
   without parens). Undeclared names are local.
5. **Immutable values → `CONST`** (usable anywhere with no declaration, no `GLOBAL`, no reassign).
6. **Functions are top-level only and non-recursive.** Return type is the name suffix
   (`FUNCTION F%`). Call with `F(...)` or `F%(...)`.
7. **Pass by reference = `REF` on the parameter; the argument must be a variable name.**
8. **Type suffixes** `% ! # $`. Under `STRICT` they're required on every identifier and implicit
   conversion is banned (be explicit with `CINT` etc.).
9. **Strings ≤ 255 bytes. `VARPTR` only on an already-assigned variable.**
10. **Use built-ins as in MSX-BASIC** (`PRINT` `VPOKE` `SET SCROLL` `SOUND` `STICK` …; identical
    behavior).
11. Variable names can be **long and descriptive** (`_` allowed; auto-compressed to 2 chars) —
    make globals and CONSTs especially so.

When an error appears, its **error code** (`E_*`) tells you the cause. The transpiler never
mis-converts silently, so trust the code and self-correct.

---

Related: [01-language-spec.md](01-language-spec.md) (full spec) / [12-builtins.md](12-builtins.md)
(built-ins) / [09-optimization.md](09-optimization.md) (speed) /
[05-transformer.md](05-transformer.md) (transform internals)
