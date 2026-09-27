# RecipeVault

Self-hosted family recipe archive. Recipes are Markdown files with YAML
frontmatter in a private vault folder; this repository holds only the app, the
docs, and invented test fixtures. Start with `PLANNING.md`; the file format and
its rules are in `docs/`.

## Setup

```sh
npm install
npm test
```

## Checker

`vault check` validates recipe files against `docs/RECIPE-SCHEMA.md` and reports
the codes of `docs/VALIDATION.md`.

```sh
npx vault check recipe.md other.md     # check files
npx vault check - < answer.txt         # a whole AI answer: every ```markdown fence is a file
npx vault check --dir inbox/           # every .md in a folder, with a summary by code
npx vault check --vault ~/vault new.md # also check slugs and sub-recipes against a vault
npx vault check --fix-block bad.md     # the block to paste back into the AI chat
npx vault check --json recipe.md       # diagnostics as JSON
npx vault prompt | xclip -sel clip     # copy the AI prompt from docs/AI-TEMPLATE.md
```

Options combine: `--quiet` prints only the summary line. Exit code 0 means no
errors (warnings allowed), 1 means at least one error, 2 a usage or IO failure.
`npm run vault -- check …` works too.

The library behind it is in `src/lib/vault/` and is browser-safe, so the app can
reuse it for live paste validation.

To run the checker over the private test corpus (prints codes and counts only):

```sh
RECIPEVAULT_CORPUS=/path/to/vault/inbox npm run test:corpus
```
