# Plan 01 — `vault check`, the recipe file checker

Status: ready to implement. Written 2026-09-27 for a fresh agent session.

## Context in one paragraph

RecipeVault is a self-hosted archive for a family's recipe collection (Quebec
French, 500–5000 recipes, many handwritten cards decades old). The workflow: a
person photographs a paper recipe, gives the photo plus a prompt to any chat AI
(ChatGPT free tier, etc.), and pastes the Markdown file it returns into the app.
The app checks it, saves it, displays it. When the file does not comply, the app
produces a **fix-request block** the person pastes back into the same AI chat. This
plan builds the first piece of code: the parser and checker that everything else
(paste box, her form UI, file watcher) will reuse. No UI, no database yet.

## Read first — the spec is in the docs, not in this plan

This plan says what to build and in what order. The rules themselves live in:

| Doc | What it defines |
|---|---|
| `docs/RECIPE-SCHEMA.md` | the file format: frontmatter keys, ingredient fields, markers, body headings |
| `docs/VALIDATION.md` | every error/warning/info code, and the exact fix-request block format |
| `docs/VOCAB.md` | canonical units with all aliases (Quebec first), source types, seasons |
| `docs/AI-TEMPLATE.md` | the prompt given to the AI, plus two tables of real-world failures found in P0 |
| `docs/STORAGE.md` | vault layout, YAML 1.2 / NFC / LF requirements |
| `PLANNING.md` | overall design and decisions; skim "P0 findings" |

If the docs contradict each other or leave a case undefined, do not silently pick
one: implement the most conservative reading, and list the question in the final
report with a proposed doc change.

## Privacy rule — non-negotiable

This repository is **public**. Real recipes live in a private vault at
`/home/cotions/RecipeVault-vault/` (see `~/.config/recipevault/config.json` once it
exists). The 20 files in `/home/cotions/RecipeVault-vault/inbox/` are real family
recipes and are this plan's test corpus.

- **Never** copy, quote, paraphrase, or snapshot anything from the vault into this
  repository — not in fixtures, tests, snapshots, commit messages, or docs. That
  includes people's names, recipe titles, and URLs.
- Fixtures in this repo are **invented**. Model them on the failure patterns in the
  `docs/AI-TEMPLATE.md` tables, never on the real files.
- The corpus is read at test time from a path given in an environment variable,
  and the corpus test prints only counts and codes, never file content.

## Stack and setup

- Node 24 (installed), npm, TypeScript strict, ESM.
- The app will be SvelteKit, so scaffold it now to keep the library in its final
  place: `npx sv create . --template minimal --types ts --no-add-ons` (or the
  current equivalent; keep the existing files). No UI work in this plan.
- Library code in `src/lib/vault/` (SvelteKit `$lib` convention). Pure TypeScript,
  no Svelte, no Node-only APIs except in the CLI — it will also run in the browser
  for live paste validation later.
- Dependencies, deliberately few:
  - `yaml` (v2) — YAML **1.2**. Never `js-yaml` defaults or any 1.1 parser: 1.1
    turns `no` into `false` and `1:30` into 5400.
  - `vitest` for tests, `tsx` to run the CLI.
- Body parsing is line-based (headings, numbered steps). No Markdown library yet —
  validation needs only headings and list items.

## Layout

```
src/lib/vault/
  types.ts        Recipe, Ingredient, IngredientGroup, Diagnostic, Severity
  vocab.ts        units + aliases, heading aliases, source types, allowed keys
  normalize.ts    NFC, LF, strip BOM
  fences.ts       split a paste into files; collect text outside fences
  markers.ts      find / strip [?] [?: x] [illisible] [+]; detect bad markers
  quantity.ts     parse qty: number | "1 1/2" | "2/3" | with markers
  duration.ts     parse 30m, 1h, 1h15m, 45m-50m
  slug.ts         slugify: strip markers, NFD, drop accents, lowercase, hyphenate
  parse.ts        text → { recipe, body } or parse diagnostics (E001/E002)
  body.ts         headings, sections, numbered steps
  rules/          one file per rule family, each exporting check(recipe, ctx) → Diagnostic[]
    identity.ts   title, slug, lang, schema, status/added
    source.ts
    times.ts      times, oven, servings, yield
    ingredients.ts
    markers.ts
    body.ts
    batch.ts      cross-file rules (slug collisions, recipe refs, cycles)
  check.ts        orchestrates: parse → rules → sorted diagnostics
  fixblock.ts     renders the fix-request block
  index.ts        public API
src/cli/vault.ts  the `vault` command
tests/
  unit/           one test file per module
  fixtures/check/ invented .md files, see Testing
  corpus.test.ts  private corpus run, skipped unless RECIPEVAULT_CORPUS is set
```

## Public API

```ts
type Severity = 'error' | 'warning' | 'info';

interface Diagnostic {
  code: string;          // 'E201' — stable, from VALIDATION.md
  severity: Severity;
  path: string | null;   // 'ingredients[0].items[3].unit' — never a line number
  message: string;       // states the fault
  fix?: string;          // states the correction, e.g. '{ qty: 500, unit: ml, name: lait }'
  file?: string;         // set in batch mode
}

splitPaste(text: string): { files: string[]; outside: string }
parseRecipe(text: string): { recipe?: Recipe; body?: Body; diagnostics: Diagnostic[] }
checkRecipe(text: string): { recipe?: Recipe; diagnostics: Diagnostic[] }
checkBatch(files: { name: string; text: string }[], opts?: { vaultDir?: string }): BatchResult
renderFixBlock(failed: { text: string; diagnostics: Diagnostic[] }[], passed: string[]): string
```

`Recipe` is the parsed, typed object — quantities parsed to numbers alongside their
original string, markers recorded with their paths, durations in seconds. It is
what the future save path and index will consume, so type it carefully.

Diagnostics are sorted errors → warnings → info, then by path.

## Rules to implement

Everything that needs only the file itself. Codes and wording per
`docs/VALIDATION.md`; every error must carry a `fix` wherever a correction can be
stated.

**Parse:** E001, E002 (include the YAML parser's own message and position).

**Identity and metadata:** E101, E102, E104, E105, E106, E107, E108, E109, E110,
E111, E112 (reported as `info`-level "will be stripped", not a rejection — see its
table entry).

**Ingredients:** E200–E217. Notes:
- E201: the message includes the alias mapping when the bad unit is a known alias
  (`tasse` → `cup`, `livre` → `lb`, `c. à thé` → `tsp`), from `vocab.ts`.
- E210 / E216: detect "number or fraction, then a unit alias" inside `name` /
  `note`, using the same alias table. Example to catch: `note: 2 lbs`,
  `note: 1/2 tasse`.
- E211: comma inside `name` with no `note`/`prep`.
- E215: `or` entries are strings or full ingredient objects, validated recursively
  with the same rules and a path like `ingredients[0].items[2].or[0].unit`.
- E217: unknown bracket markers, and prose uncertainty (`lecture incertaine`,
  `incertain`, `illisible` without brackets, `?)`) anywhere in string values.
- Language-dependent aliases: in a `lang: fr` recipe `t.` means cup; in `lang: en`
  `T` is tbsp and `t` is tsp (VOCAB.md).

**Markers:** W605 (list every location), I701 for `[+]`. Markers are stripped
before slug derivation, and quantity strings may carry them (`"250 [?]"`).

**Body:** E301, W401, W402, W609 (a 3-digit temperature with `°`/`F`/`C` in a step
while `oven` is absent).

**Completeness:** W601, W602, W604.

**Paste:** I702 when `splitPaste` found text outside the fences (a `QUESTIONS`
section, for instance) — surface it, never treat it as an error.

**Unknown keys:** add **W610 — unknown frontmatter key** (catches `serving:`,
`temps:`), with a did-you-mean from the allowed key list. This is a new code: add
it to `docs/VALIDATION.md` in the same commit.

**Batch / vault (phase 3):**
- E103 when a slug collides with another file in the same batch, or with
  `<vaultDir>/recipes/<slug>.md` when `--vault` is given.
- W306 for `recipe:` references to slugs in neither the batch nor the vault.
- E213 for sub-recipe cycles across the batch + vault.
- W503 / W608 for same or near-identical titles (normalized: markers stripped,
  lowercase, accents dropped; near = edit distance ≤ 2).

**Deferred to the ingredient-registry plan** (need `ingredients/` and `vocab/` data
that does not exist yet): W302–W305, W501, W502, W606, W607. Leave a clearly marked
stub list in `rules/` so they are not forgotten.

## The fix-request block

Reproduce the format in `docs/VALIDATION.md` exactly — its wording is tuned for an
AI reader. Specifically:
- errors and warnings in separate labelled sections, warnings marked non-blocking
- each entry: `[CODE] path: message` then the fix on the next, indented line
- the full rejected file between `--- YOUR FILE ---` / `--- END FILE ---`
- for a multi-recipe paste: only failing files included, plus one line listing the
  titles that already passed so the AI does not resend them
- include the spec pointer paragraph only when the heuristic in VALIDATION.md says
  so (several E2xx at once, or E001)

Snapshot-test it on invented fixtures.

## CLI

```
vault check <file...>          check files; '-' reads a paste from stdin
vault check --dir <dir>        every .md in a directory, batch rules on
vault check --vault <dir>      also check collisions/references against a vault
      --json                   diagnostics as JSON (the app will reuse this)
      --fix-block              print the fix-request block for failing files
      --quiet                  only the summary line
vault prompt                   print the prompt from docs/AI-TEMPLATE.md
```

- Human output per file: `✗ file.md  2 errors, 1 warning` then the diagnostics;
  `✓ file.md` when clean. Colour when stdout is a TTY.
- `--dir` ends with a **summary sorted by code frequency** — the point of batch
  checking is spotting systematic prompt problems (VALIDATION.md explains why).
- Exit codes: 0 no errors (warnings allowed), 1 any error, 2 usage/IO failure.
- `vault prompt` extracts the fenced block under `## The prompt` in
  `docs/AI-TEMPLATE.md` at runtime, so the doc stays the single source of truth.
  (Lets the user run `npx vault prompt | xclip -sel clip` today.)
- Wire it as an npm bin (`"bin": { "vault": ... }` via tsx) and an npm script.

## Testing

**Unit tests** per module: quantities (`2`, `0.5`, `"1 1/2"`, `"2/3"`, `"1/8"`,
`"250 [?]"`, garbage), durations (every valid form plus `2 hrs`, `1 1/4 heure`,
`45-50 minutes` as failures), slugs (accents, `œ`, markers, apostrophes), markers,
fences (zero, one, several fences; text before and after; no fence but starts with
`---`), NFC (`é` precomposed vs combining must compare equal).

**Fixture tests** in `tests/fixtures/check/`, all invented:
- `valid/` — must produce zero errors. Include a Quebec-style card using `cup`,
  `lb`, fractions, `alt`, `or` with an object entry, an optional group with its
  `###` steps, markers, `oven`, `servings_max`; and the existing
  `tests/fixtures/vault/recipes/lasagna-bolognaise.md`.
- `invalid/<CODE>-<what>.md` — one deliberate fault each; the test asserts that
  exact code is present among the errors and no *other* error code fires. At least
  one file per implemented E-code.
- Multi-recipe paste fixtures (two fences, one failing) for `splitPaste` and the
  fix block.

**Private corpus test** — `tests/corpus.test.ts`, skipped unless
`RECIPEVAULT_CORPUS` is set:

```
RECIPEVAULT_CORPUS=/home/cotions/RecipeVault-vault/inbox npm run test:corpus
```

It runs `checkBatch` over the directory and prints, per file name, the list of
codes — **no content**. It asserts nothing strict; it is for the report. Expected
shape, from the manual review already done:
- the 10 files without `-v2` were made with template draft 1: many E201 / E216
  (quantities stuck in `note` as tasse/livre), E109 (times like `2 hrs`), E108
  (`servings: 8-10`), E217 (prose "lecture incertaine"), E112 (`status`, `added`).
- the 10 `-v2` files were made with draft 2: mostly passing; W605 on the files
  with `[?]`; I701 where `[+]` appears; E103 between the two files sharing slug
  `pain-de-viande` (batch mode); probably an E216 on a note holding an
  alternative's amount (the `or`-object case draft 3 fixed).

If the real result differs from this, **report the difference; do not tune the
checker to the corpus.** A difference is either a checker bug or a spec gap, and
the report should say which.

## Phases and commits

1. **Scaffold** — SvelteKit minimal + TS strict + vitest + `yaml` + `tsx`;
   `npm test` runs green on an empty suite. Commit.
2. **Single-file checker** — types, vocab, parse, all single-file rules, fix
   block, unit + fixture tests. Commit (may be several commits).
3. **Batch + CLI** — `checkBatch`, batch rules, `--vault`, the CLI, `vault prompt`,
   corpus test. Commit.
4. **Docs** — W610 added to VALIDATION.md; short "Checker" section in the README
   (create a minimal README if none) with the CLI usage. Commit and push.

Commit messages: conventional (`feat:`, `test:`, `docs:`, `chore:`), plain
English, describing the change — and per the privacy rule, never mentioning real
recipe content.

## Done when

- `npm test` green; every implemented E-code has an invalid fixture.
- `vault check tests/fixtures/check/valid/*` exits 0; each invalid fixture exits 1
  with its code.
- `vault check --fix-block` on an invalid fixture prints a block matching the
  VALIDATION.md format.
- `vault check --dir <corpus>` runs over the 20 real files without crashing.
- The library imports nothing Node-specific (the CLI does).
- `git grep` over the repo finds none of the corpus's names, titles, or URLs.

## Final report to the user

1. What was built, and the commands to run it.
2. Corpus results: a table of file → codes (names only, no content), plus the
   code-frequency summary.
3. Every place the corpus result differed from the expected shape above, and
   whether it is a checker bug or a spec gap.
4. Spec questions found while implementing, each with a proposed doc change.
5. Anything skipped, and why.

## Out of scope

Saving to the vault, canonical serialization, git commits in the vault, the SQLite
index, the ingredient registry and its rules, any UI, the file watcher, auth. Each
gets its own plan.
