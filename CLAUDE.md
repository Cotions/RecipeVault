# RecipeVault

Self-hosted family recipe archive. Recipes are Markdown files with YAML
frontmatter in a private vault folder; this repository holds only the app, docs,
and invented test fixtures.

## Privacy — read before anything else

This repository is **public**. Real recipes live outside it, in the private vault
(`/home/cotions/RecipeVault-vault/`, pushed to the private `Cotions/RecipeVault-recipes`).

Never copy, quote, or paraphrase vault content into this repository — fixtures,
tests, snapshots, docs, or commit messages. No real names, recipe titles, or URLs.
Test fixtures here are invented. Tests that need the real files read them from the
path in `RECIPEVAULT_CORPUS` and print only codes and counts.

## Where things are

- `PLANNING.md` — design and decisions
- `docs/` — the spec: `RECIPE-SCHEMA.md` (format), `VALIDATION.md` (error codes,
  fix-request block), `VOCAB.md` (units, aliases), `AI-TEMPLATE.md` (the prompt),
  `STORAGE.md` (vault layout), `INGREDIENTS.md`, `DATA-FLOW.md`
- `docs/plans/` — implementation plans, one per piece of work

The docs are the source of truth. When code and docs disagree, or a doc leaves a
case undefined, raise it rather than silently choosing.

## Conventions

- The recipe collection is Québécois: cups, pounds, °F, *c. à thé*, *piment vert*
  (a bell pepper). Keep that in mind for any parsing or display logic.
- YAML 1.2 only (`yaml` package). Normalize text to NFC and LF.
- Stable diagnostic codes from `docs/VALIDATION.md`; paths like
  `ingredients[0].items[3].unit`, never line numbers.
- Library code in `src/lib/` stays browser-safe; Node-only code lives in the CLI.
- Conventional commit messages.
