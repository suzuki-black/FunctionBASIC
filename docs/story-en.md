# Getting Revenge on the MSX-BASIC That Defeated Me

*Originally published in Japanese on [note](https://note.com/hot_daphne8758/n/n99d41099ee6e), 19 July 2026. Translated by the author.*

![An orange tabby cat asleep on a wooden bench](images/story-hero.jpg)
<!-- Download from https://unsplash.com/photos/aE-iTwRA4oQ (Unsplash License) and save as docs/images/story-hero.jpg -->
<sub>Photo by Samuel Toh on [Unsplash](https://unsplash.com/photos/aE-iTwRA4oQ)</sub>

## Introduction

As a kid, I delivered newspapers to buy an MSX.

I can still remember the thrill of carrying that box home from a small-town camera shop, "CASIO MSX PERSONAL COMPUTER" printed across it in giant letters.

> The tool described in this article, FunctionBASIC, is here:
> https://github.com/suzuki-black/FunctionBASIC

The excitement did not last long. The moment I sat in front of the MSX-BASIC prompt, I hit a wall.

- Line numbers
- Variable names limited to two characters
- Cryptic sprite functions
- The maze of READ/DATA

Staring at columns of `10`, `20`, `30`, I got lost again and again. The code needed to move a sprite looked like an incantation. I had no idea what was wrong or what was even happening.

I gave up on MSX-BASIC. My interest in the MSX drifted to the games Konami kept releasing, the ones that pushed past what the hardware was supposed to be able to do.

## What exactly hurt? — the answer, X years later

Back then I could not put into words what I did not understand or why it was painful. It was just "hard."

Looking back now, it was not only my own ability. The language itself betrayed human intuition. Let me go through it, one item at a time.

### 1. What "two-character variable names" really means

This one was the cruellest.

MSX-BASIC does not actually say "variable names may be at most two characters." You can write a long name and get no syntax error. It simply **only looks at the first two characters.**

```basic
10 HERO_X = 100
20 HERO_Y = 50
30 PRINT HERO_X, HERO_Y
```

What happens inside the MSX here? First, `_` is not allowed in variable names, so this is already an error. Fine, drop the underscore:

```basic
10 HEROX = 100
20 HEROY = 50
30 PRINT HEROX, HEROY
```

No error. It runs. And it prints **50 twice.**

Why? To the MSX, both `HEROX` and `HEROY` begin with `HE`. They are the same variable. Line 20, `HEROY = 50`, overwrites line 10's `HEROX`. Two names that *look* like they can coexist stop coexisting the instant you assign to them. That alone was enough to confuse the child I was.

(There is a trap even before that one. MSX slices reserved words out of the middle of names. `POSX`, for instance, may be read as `POS X` — `POS` being the cursor-position function — and break. So the moment you try to give something a *meaningful* name, you collide with reserved words before you even reach the two-character problem.)

What makes it worse is that **there is no error** (or at best a bare Syntax error). A syntax error at least tells you *where*. This runs silently and produces silently wrong results. As a child I had no way to track down the cause.

It happens everywhere:

```basic
10 SCALE = 0      ' SC
20 SCREEN 1       ' <- a statement, so this one is safe
30 SCROLL = 5     ' SC <- same variable as SCALE!
40 PRINT SCALE    ' prints 5
```

`SCALE` and `SCROLL`. Completely different words to a human. To the MSX, both are `SC`.

That is why every beginner's book of the era used names like `X, Y, SX, SY, I, J`. It was idiom, and it was also self-defence.

The price of that defence is code you cannot read three days later. What was `SX` again? I remember keeping a variable table in a notebook. I was not writing programs; I was maintaining a variable registry.

### 2. The curse called line numbers

```basic
10 SCREEN 1
20 X = 10
30 GOSUB 1000
40 IF X > 100 THEN GOTO 60
50 GOTO 20
60 PRINT "END"
70 END
```

You want to add one line here. You put it at 25. The next one? 27. The one after that? 26. Eventually there is no room left and you type `RENUM`. The numbers get reassigned — and so do the targets of `GOTO 60` and `GOSUB 1000`, which is fine, except that line numbers inside strings or computed jump targets, of course, do not follow.

The deeper problem: looking at `GOSUB 1000` tells you nothing about what that subroutine *does*. You jump to line 1000, read it, come back. It has no name, so it has no meaning.

No parameters either. No return value. The only way to talk to a subroutine is to put values in global variables and rely on an unwritten agreement.

```basic
10 X = 5 : Y = 3
20 GOSUB 1000
30 PRINT Z
40 END
1000 Z = X + Y
1010 RETURN
```

"Set X and Y, then call; the answer is in Z." That contract is written nowhere in the code. You can only put it in a comment. Forget the comment and it is gone. And since X, Y and Z are global, some other subroutine will happily trample them.

### 3. You cannot put a block inside an IF

This one hurt a lot. An MSX-BASIC `IF` must fit on a single line.

```basic
10 IF X > 100 THEN X = 0 : Y = Y + 1 : GOSUB 2000
```

You can chain statements with `:`. But add an `ELSE` and it becomes unreadable:

```basic
10 IF X>100 THEN X=0:Y=Y+1:GOSUB 2000 ELSE X=X+1:GOSUB 3000
```

Try to nest it and it is beyond saving:

```basic
10 IF X>100 THEN IF Y>50 THEN GOSUB 2000 ELSE GOSUB 3000 ELSE GOSUB 4000
```

If you can tell at a glance which `IF` each `ELSE` belongs to, I salute you. And since a line is limited to 255 bytes, past a certain point you physically cannot write it.

So the standard trick of the day was to use `IF` as a *conditional GOTO* (opinions vary):

```basic
10 IF X <= 100 THEN GOTO 50
20 X = 0
30 Y = Y + 1
40 GOSUB 2000
50 REM merge point
```

Invert the condition and skip when it does not hold. That "invert and jump" way of thinking was really hard for a child. What you want to say and what you write are mirror images.

### 4. Sprites, the incantation

MSX hardware sprites are one colour each (on MSX1). To show a multi-coloured character, you stack several sprites at the same position — the classic technique.

Moving one cat in MSX-BASIC looks like this:

```basic
10 SCREEN 2 : SPRITE$(0) = CHR$(...)...
...
100 X = X + DX : Y = Y + DY
110 IF X < 0 THEN X = 0 : DX = -DX
120 IF X > 240 THEN X = 240 : DX = -DX
130 IF Y < 0 THEN Y = 0 : DY = -DY
140 IF Y > 180 THEN Y = 180 : DY = -DY
150 PUT SPRITE 0,(X,Y),15,0
160 PUT SPRITE 1,(X,Y),9,1
170 GOTO 100
```

X, Y, DX, DY are all global. Want two cats? You add `X2, Y2`… `X2` begins with `X2`, so that is safe — but what about `DX2`? It collides with `DX` (both are `DX`). Every new cat starts another round of variable-name chess.

The arguments to `PUT SPRITE 0,(X,Y),15,0` are a spell until you memorise them: sprite number, position, colour, pattern number. Get the order wrong and there is no syntax error — just nothing on screen, or something in the wrong place.

### 5. The READ/DATA maze

Sprite patterns and map data always end up in `READ` / `DATA`.

```basic
10 FOR I = 0 TO 7
20 READ A
30 P$ = P$ + CHR$(A)
40 NEXT I
50 SPRITE$(0) = P$
...
900 DATA 60,126,255,255,255,255,126,60
```

The problem is that `DATA` is **one single one-dimensional stream across the whole program.** `READ` keeps exactly one invisible pointer — "how far have I read" — and every `DATA` line, wherever it sits, is strung together in line-number order.

Which means:

- Forget one `DATA` value and *everything after it* shifts by one
- No error when it shifts. The sprite just looks slightly broken
- To find where it went wrong, you count by eye
- `RESTORE` can rewind, but `RESTORE 900` points at a line number, so renumbering breaks it
- As data grows, `DATA` lines stretch on forever and you lose track of what is what

As a child I never figured out why my sprite patterns came out mangled. I am now fairly sure I had miscounted a `DATA` line by one. Write 7 values where 8 were needed and everything downstream collapses — and the MSX of that era had nothing that could detect it.

### 6. A colourless screen, and no view of the whole

This one is about the environment rather than the language. But it wore me down, so it belongs here.

The MSX-BASIC editor has no syntax highlighting. Keywords, variables, numbers, strings, comments — all the same colour. Whether `PRINT` is a keyword, whether `"100"` is a string or the number `100`: the screen alone will not tell you.

Nor can you see the whole. A screen shows a dozen-odd lines. To see more you type `LIST 200-300` and scroll. What shape the program has — where the loops are, where the subroutines are, where the main body is — exists only in your head. No indentation. Just line numbers flowing from top to bottom.

Match the brackets by eye, count the `DATA` values on your fingers, compute the first two characters of every variable name in your head. Most of the effort of reading the code is spent on things that have nothing to do with the code. That flat, featureless lack of overview amplified every pain above many times over.

## Time passed — and I got a weapon called vibe coding

I grew up and met C, C++, Java and many others. Functions, structs, free variable names. No line numbers to worry about. Editors that paint code in colour.

"Programming was *this* easy to understand?"

The moment I thought that, something stirred. *I want to make a game on the MSX that beat me.*

But for someone used to modern editors, going back to the MSX-BASIC environment is frankly painful. Managing line numbers, squeezing names into two characters, lining up `DATA` statements. All the old misery comes back.

Still, the dream of making an MSX game kept growing, year after year.

And then the times moved again. Writing code in dialogue with an AI — "vibe coding" — became a real tool. Something that would once have been reckless for someone with my abilities, *building a language implementation from scratch*, came within reach with an AI as a partner.

In that instant, the homework I had left unfinished as a child and the weapon I now held joined into a single line. If MSX-BASIC is painful, build a *different* BASIC that runs on the MSX, and take revenge with that.

That idea became **FunctionBASIC**. Write structured BASIC, press one button, get authentic MSX-BASIC. Built to crush, one by one, each of the pains above.

## How FunctionBASIC solves those six

One principle: **take away nothing of the MSX's expressive power; strip only the inconveniences of the MSX-BASIC language.** The output is therefore always plain, honest MSX-BASIC. In order:

### 1. Long names are translated to two characters by the transpiler

```basic
PLAYER_POS_X = 100
PLAYER_POS_Y = 50
ENEMY_POS_X = 200
ENEMY_POS_Y = 80
SCORE = 0
SCROLL_SPEED = 5

PRINT PLAYER_POS_X, PLAYER_POS_Y
```

Underscores allowed, any length. It works exactly as written. Converted, it becomes:

```basic
100 ' === MAIN ===
110 A=100
120 B=50
130 C=200
140 D=80
150 E=0
160 F=5
170 PRINT A,B
180 END
```

The transpiler has a name allocator: `PLAYER_POS_X → A`, `PLAYER_POS_Y → B`, and so on, assigning valid MSX names whose first two characters are guaranteed unique. `_` never appears in the output.

The allocation is also pooled per type (`%` integer / `!` single / `#` double / `$` string, roughly 960 names each — 26 first characters × about 36 second characters). MSX reserved words like `IF TO ON OR FN` are excluded from the pool, so "my variable happened to be a reserved word and I got a mysterious Syntax error" cannot happen.

Local variables whose lifetimes do not overlap share names. A temporary used only inside function A and one used only inside function B can both be `D`. So the 960 limit is far roomier than it looks. And if you do exhaust it, it does not break silently: you get the error code `E_VAR_NAMES_EXHAUSTED`.

In other words: the variable table I kept in a notebook as a child, the transpiler now keeps for me.

### 2. Line numbers become names and functions

```basic
FUNCTION ADD(A, B)
    RETURN A + B
END FUNCTION
PRINT ADD(5, 3)
```

It has a name. It has parameters. It has a return value. There is not a line number in sight.

A real example from the README:

```basic
' Return the index of the first 0 in the array
FUNCTION FIND_ZERO(REF IDX)
    GLOBAL A
    FOR I = 1 TO 10
        IF A(I) = 0 THEN
            IDX = I
            RETURN 1
        END IF
    NEXT I
    RETURN 0
END FUNCTION

DIM A(10)
A(3) = 0
RESULT = FIND_ZERO(FOUND_AT)
PRINT "FOUND="; RESULT; " AT "; FOUND_AT
```

converts to:

```basic
100 ' === MAIN ===
110 ' Return the index of the first 0 in the array
120 DIM A(10)
130 A(3)=0
140 GOSUB 1000: B=E
150 PRINT "FOUND=";B;" AT ";C
160 END
1000 ' === FUNCTION FIND_ZERO (IDX->C) ===
1010 FOR D=1 TO 10
1020 IF A(D)=0 THEN C=D: E=1: RETURN
1030 NEXT
1040 E=0: RETURN
```

Reading it is fun.

The line-numbering rule is fixed: top-level (MAIN) starts at 100; each function gets its own 1000-step segment (1000, 2000, 3000…). Adding a function never shifts existing numbers. RENUM hell is structurally impossible.

`140 GOSUB 1000: B=E` — this is what a function call really is. `GOSUB` jumps, and immediately on return the internal return-value variable `E` is copied to `B` (= `RESULT`). The convention I used to write by hand is now generated mechanically.

`REF IDX` has become `C`. The comment `1000 ' === FUNCTION FIND_ZERO (IDX->C) ===` is inserted automatically, making the mapping explicit. The caller's `FOUND_AT` is also `C`, so writing `C=D` inside the function updates the caller. That is pass-by-reference. By hand, a human has to remember "we share variable C"; here the machine does.

`1030 NEXT` — the `NEXT` is emitted without its variable. In MSX-BASIC a bare `NEXT` is slightly faster and smaller than `NEXT D`. A tiny detail, but it reproduces a hand-optimisation trick.

The comment (line 110) survives. The generated code is still readable.

And, importantly, the limits of this scheme are stated out loud. Locals and return-value variables come from a fixed two-character pool, so recursion fundamentally cannot work (it would overwrite the same names). When FunctionBASIC detects recursive or mutually recursive calls, it does not quietly emit broken code; it stops with `E_RECURSION_UNSUPPORTED`. The design never produces "runs, but wrong."

Because "runs, but wrong" is exactly what made me give up as a child.

*(Translator's note: recursion has since been implemented via a software stack; see the README.)*

### 3. IF can be a block

```basic
IF X > 100 THEN
    X = 0
    Y = Y + 1
    UPDATE_STAGE()
ELSE
    X = X + 1
    MOVE_PLAYER()
END IF
```

Block-form `IF / ELSE / END IF`. Nest freely — inside `WHILE / WEND`, inside `FOR / NEXT`, as deep as you like. `BREAK` and `CONTINUE` exist too.

On conversion, the transpiler inverts the condition and expands to `GOTO` for you. The "flip the condition in your head" step I did by hand as a child simply disappears.

Then there is automatic splitting of 255-byte lines. When a generated line would exceed 255 bytes, it is re-packed into several lines at `:` or `;` boundaries. A line that truly cannot be split (certain `IF…THEN` forms) is reported as an error rather than silently truncated.

### 4. Sprites are not hidden — PUT SPRITE stays PUT SPRITE

```basic
' One cat = two sprites at the same position (two colours)
PUT SPRITE 0, (CATX, CATY), 15, 0 ' front: white face
PUT SPRITE 1, (CATX, CATY), 9, 1  ' back: orange body
```

becomes:

```basic
300 PUT SPRITE 0,(A,B),15,0
310 PUT SPRITE 1,(A,B),9,1
```

Notice that the `PUT SPRITE` statement itself is not converted at all. Coordinates, colour number, pattern number — untouched. The only change is `CATX → A`, `CATY → B`.

I think this matters as a design philosophy. FunctionBASIC is not a language that *hides* the MSX. You write `PUT SPRITE` as `PUT SPRITE`. You face the hardware directly, and only the defects of the MSX-BASIC *language* (two-character variables, line numbers, one-line IF) are removed.

So when you want ten cats, you write:

```basic
FUNCTION DRAW_CAT(SPRITE_NO, CAT_X, CAT_Y)
    PUT SPRITE SPRITE_NO * 2, (CAT_X, CAT_Y), 15, 0
    PUT SPRITE SPRITE_NO * 2 + 1, (CAT_X, CAT_Y), 9, 1
END FUNCTION
```

A function with parameters, so no variable-name chess. The wall I could never climb as a child is gone.

MSX2-specific syntax — palette setting with `COLOR=(n,r,g,b)`, VRAM block transfers with `COPY…TO…`, the `,B` / `,BF` options of `LINE`, double-buffering with `SET PAGE`, `POINT` and `PLAY` used as functions — is preserved just the same. Only the writing experience is modernised; not a millimetre of the MSX's expressive power is lost.

### 5. From READ/DATA to arrays and functions

The root of the READ/DATA maze was that *data has no name*. One invisible pointer, program-wide, sweeping through `DATA` in numeric order. Shift by one and everything after it shifts.

FunctionBASIC's answer is `DATASET` — a named data block (FunctionBASIC's own syntax). Give a chunk of data a name.

```basic
DATASET CAT_PATTERN
    DATA 60, 126, 255, 255, 255, 255, 126, 60
END DATASET

DATASET DOG_PATTERN
    DATA 24, 60, 126, 255, 255, 126, 60, 24
END DATASET

DIM CAT(7)
DIM DOG(7)
FOR I = 0 TO 7
    READ CAT_PATTERN INTO CAT(I)
NEXT I
FOR I = 0 TO 7
    READ DOG_PATTERN INTO DOG(I)
NEXT I
```

`READ CAT_PATTERN INTO CAT(I)` — *which* block to read from is written by name. Converted:

```basic
100 ' === MAIN ===
110 A%=0
120 DIM A(7)
130 DIM B(7)
140 FOR C=0 TO 7
150 IF A%<>1 THEN RESTORE 1000:A%=1
160 READ A(C)
170 NEXT
180 FOR C=0 TO 7
190 IF A%<>2 THEN RESTORE 1010:A%=2
200 READ B(C)
210 NEXT
220 END
1000 DATA 60, 126, 255, 255, 255, 255, 126, 60
1010 DATA 24, 60, 126, 255, 255, 126, 60, 24
```

Each pain point is crushed in place.

- **RESTORE points by name.** Write `RESTORE CAT_PATTERN` in the source and the transpiler turns it into that block's label (1000). No more hard-coded `RESTORE 900`, so renumbering cannot break it.
- **Blocks do not bleed into each other.** `150 IF A%<>1 THEN RESTORE 1000:A%=1` — a small internal integer `A%` remembers which block is being read and issues a `RESTORE` only when the block changes. A read of `CAT_PATTERN` can never run into `DOG_PATTERN`'s data: the off-by-one cascade is gone.
- **You can see what data it is.** No need to hunt for line 900; the single line `READ CAT_PATTERN INTO …` tells you.

Put anything other than `DATA` inside a block and you get `E_DATASET_BODY`; duplicate a name, `E_DATASET_DUP`; read a name that does not exist, `E_DATASET_UNKNOWN`. Again, nothing breaks silently.

(To be honest: miscount the `DATA` values *within* one block and that block will still shift. But the damage is contained to that named block; unrelated data is never caught in the blast. From "everything collapses" to "just that block" — the blast radius shrinks by orders of magnitude.)

And there is `INCLUDE` for multi-file projects. Sprite patterns in `patterns.msxb`, the main loop in `main.msxb`. A preprocessor expands them into one program, with duplicate-include elimination and circular-include detection. The sight of `DATA` stretching on forever from line 900 is gone for good.

### 6. An editor with colour, and the conversion right beside you

You write FunctionBASIC inside a modern editor. Keywords, variables, strings and comments are coloured; `FUNCTION … END FUNCTION` and `IF … END IF` show their structure through indentation. Not that flat, monochrome screen.

And as you type, the converted MSX-BASIC appears in the pane next to it. Matching brackets and counting `DATA` values by eye simply does not arise on the structured-BASIC side. Write something that cannot be converted and an error with line and column appears as a marker, right there (next section).

That exhaustion of being pulled away from the code by its own illegibility is gone.

## Designed, as far as possible, to never break silently

Writing all this, I noticed something myself. Everything that defeated me in MSX-BASIC took the shape of *going wrong without producing an error*.

- `HEROX` and `HEROY` become the same variable — no error
- Forget one `DATA` value — no error
- `IF…ELSE…ELSE` pairs up wrongly — no error
- `RENUM` breaks a `GOTO` target — you only find out at run time

So in FunctionBASIC that is where I was most careful. The transpiler does its best never to mis-convert silently. Unsupported syntax and errors are always reported with an error code and a line/column position, and shown as inline markers in the editor gutter (left of the line numbers).

- Variable-name pool exhausted → `E_VAR_NAMES_EXHAUSTED`
- Recursive call detected → `E_RECURSION_UNSUPPORTED`
- A line over 255 bytes that cannot be split → not truncated, but `E_LINE_TOO_LONG`

File encoding follows the same philosophy. Real MSX hardware uses Shift-JIS, so files are converted to Shift-JIS on save. If a character cannot be represented, it is reported rather than mangled. "I saved and all my Japanese turned to garbage" cannot happen.

## Write → convert → run, in one click

One more thing that hurt back then: the iteration loop was slow. Write, `RUN`, watch it fall apart, `LIST`, fix, `RUN` again — with tape or floppy reads and writes in between.

FunctionBASIC is self-contained in the editor.

- Write structured BASIC in the left pane
- The "MSX-BASIC (output)" tab on the right shows the conversion live as you type
- Press **▶ WebMSX** (or Ctrl/Cmd+Enter): the embedded webMSX boots and `RUN`s it automatically

Having the conversion always visible is, for me, the part that really works. You *learn* what MSX-BASIC a given construct turns into. It does not hide the MSX; it shows you the MSX while making life easier.

For real hardware or openMSX, "Save Disk (.dsk)" writes out a 720 KB FAT12 disk image (still being verified).

### Limitations of the embedded player (honestly)

The in-app webMSX is embedded as a cross-origin iframe, which restricts it to rebooting from a data-URL disk on every run. Consequently:

- **FM (MSX-MUSIC) does not sound.** Programs using `CALL MUSIC` / `PLAY #2` convert correctly and play on MSXPen, openMSX and real hardware, but are silent in the embedded player. The cause is unknown; I suspect it runs before the FM chip is initialised after the reboot, but have not confirmed it
- **MSX-AUDIO (Y8950) unsupported** — webMSX itself does not emulate it
- State is not preserved between runs, since every run reboots
- turbo R-only programs require switching the machine in webMSX's gear menu
- Browser autoplay restrictions may mute audio until you click the screen once

None of this affects the conversion itself (the generated MSX-BASIC should be correct). To hear FM, the reliable route for now is the **📋 Copy** button and pasting the converted code into MSXPen.

## And now, at last, it has taken shape

The FunctionBASIC published on GitHub still has *unproven* parts. It is experimental and evolving. There are rough edges, there will be breaking changes, there are missing features.

Even so, it exists as a desktop app for Windows and macOS (unsigned installers; built with Tauri. The browser version should also run without any build tooling via `npm run serve`).

If you are at all curious, please try it. And look at the converted MSX-BASIC. Those `A B C D` lined up in the output are the very variable table I used to write by hand in a notebook as a child.

A language for taking revenge, decades later, on the MSX-BASIC that defeated me as a kid — it is here.

https://github.com/suzuki-black/FunctionBASIC
