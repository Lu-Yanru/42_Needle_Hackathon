# CLI Password Generator

Build a CLI program called `solution.py`.

## Usage

```bash
python3 solution.py [--length L] [--count N] [--seed S] [--symbols] [--no-lower] [--no-upper] [--no-digits]
```

All flags are optional. If a flag is given more than once, the last value wins.

## Options

| Flag         | Meaning                                       | Default                |
| ------------ | --------------------------------------------- | ---------------------- |
| `--length L` | Length of each password                       | `16`                   |
| `--count N`  | Number of passwords to generate               | `1`                    |
| `--seed S`   | Integer RNG seed; makes output reproducible   | none (system entropy)  |
| `--symbols`  | Enable the symbols character class            | disabled               |
| `--no-lower` | Disable the lowercase class                   | lowercase enabled      |
| `--no-upper` | Disable the uppercase class                   | uppercase enabled      |
| `--no-digits`| Disable the digits class                      | digits enabled         |

## Character classes

Each class is exactly this set of characters, in this order:

| Class     | Characters                   |
| --------- | ---------------------------- |
| lowercase | `abcdefghijklmnopqrstuvwxyz` |
| uppercase | `ABCDEFGHIJKLMNOPQRSTUVWXYZ` |
| digits    | `0123456789`                 |
| symbols   | `!@#$%^&*()-_=+[]{}`         |

The classes have a fixed order: **lowercase, uppercase, digits, symbols**.
"Enabled classes" means the subset of these still active after the `--no-*` and
`--symbols` flags are applied, kept in that fixed order.

## Generation algorithm

This algorithm is normative. A given `--seed`, together with the same options,
MUST produce identical output on every run and on any Python 3 interpreter.

1. Build `alphabet` as the concatenation of every enabled class's characters, in
   the fixed class order.
2. Seed the RNG:
   - If `--seed S` was given, call `random.seed(S)`.
   - Otherwise call `random.seed()` (system entropy — output is not reproducible).
3. Generate `--count` passwords. Do **not** re-seed between passwords; draw them
   sequentially from the same RNG stream. For each password:
   1. Start with an empty list of characters.
   2. For each enabled class, in the fixed class order, append
      `random.choice(<that class's characters>)`. This guarantees at least one
      character from every enabled class.
   3. While the list has fewer than `--length` characters, append
      `random.choice(alphabet)`.
   4. Call `random.shuffle()` on the list.
   5. Join the list into a string — that is the password.
4. Print each password on its own line to stdout, in generation order.
5. Exit with code `0`.

Use the standard library `random` module — **not** `secrets`. This is
deliberate: `random` is seedable, which is what makes `--seed` reproducible
(`secrets` cannot be seeded). Cryptographic strength is explicitly not a
requirement of this task.

## Error handling

On any invalid input, print a single line to **stderr**, write **nothing to
stdout**, and exit with code `1`.

Validate in the order below and report only the first failure. The table order
is the precedence: an unknown flag is reported before any value error.

| # | Condition                                              | stderr message (exact)                                                  |
| - | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1 | An unrecognised flag `<flag>` is present                | `error: unknown option: <flag>`                                         |
| 2 | `--length` value is missing or not an integer ≥ 1       | `error: --length must be a positive integer`                            |
| 3 | `--count` value is missing or not an integer ≥ 1        | `error: --count must be a positive integer`                             |
| 4 | `--seed` is present but its value is missing/not an int | `error: --seed must be an integer`                                      |
| 5 | No character class is enabled                           | `error: at least one character class must be enabled`                   |
| 6 | `--length` is less than the number of enabled classes   | `error: --length must be at least the number of enabled character classes` |

In message 1, `<flag>` is the offending token exactly as it appeared on the
command line.

## Examples

All examples below are exact and verified.

```
$ python3 solution.py --seed 42
05giropRLVVVDfuI
```

```
$ python3 solution.py --seed 7 --length 20 --count 3 --symbols
&je(1#i6=BEkm3hlU@El
irmy7_}@=&V$22hV(-AO
R6=^d@t!O1j)RS_Qi[f6
```

```
$ python3 solution.py --seed 0 --length 8 --count 2 --no-upper --no-digits
pmqymnbi
dteizjry
```

```
$ python3 solution.py --length 2 --symbols
error: --length must be at least the number of enabled character classes
```

(The line above is written to stderr; exit code is `1`. With `--symbols` all
four classes are enabled, so `--length` must be at least `4`.)

```
$ python3 solution.py --length 0
error: --length must be a positive integer
```

Without `--seed`, output is random and differs on every run; only the seeded
examples are byte-reproducible.

## How this will be tested

An automated suite scores the program with three kinds of checks:

- **Exact-match** — seeded runs (`--seed`) are compared byte-for-byte against the
  output of the algorithm above. The seeded examples are anchors.
- **Property** — unseeded runs are checked for the right number of lines
  (`--count`), the right length per password (`--length`), every character drawn
  from an enabled class, and at least one character from every enabled class.
- **Error** — each row of the error table is checked for the exact stderr
  message and exit code `1`.

## Constraints

- Python 3 standard library only — no third-party packages.
- No debug prints. On a successful run, stdout contains only the generated
  passwords (one per line) and nothing else.
- On an error, stdout is empty; the only output is the single stderr line.
- Do not re-seed between passwords within one run.
