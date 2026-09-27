# Validation and the AI fix-request block

Draft 1. Companion to `AI-TEMPLATE.md`.

Validation has an unusual requirement here: most invalid files are produced by an
AI, not a human. So an error message is not for a person to read and act on — it is
**input to the next AI turn**. That makes the output format part of the design, not
an afterthought.

## The fix-request block

When a paste fails validation, the app shows exactly one thing prominently: a
copy button producing a block designed to be pasted straight back into the AI chat
that produced the bad file.

```text
RECIPEVAULT — FILE REJECTED

Your previous output did not validate. Fix every ERROR below, then return the
COMPLETE corrected file inside one ```markdown fence. Output nothing else. Do not
explain the changes. Do not return a partial file or a diff.

ERRORS — must fix:
  [E201] ingredients[0].items[3]: `unit: "cuillere"` is not allowed.
         Allowed units: g, kg, ml, cl, l, cup, tbsp, tsp, pinch, drop, lb, oz,
         piece, clove, leaf, sprig, stalk, bunch, slice, can, packet, bottle,
         jar, bag, qt, pint
  [E203] ingredients[0].items[6]: `qty: 2` present but `unit` missing.
         Every qty needs a unit. Countable items use `unit: piece`.
  [E210] ingredients[1].items[2]: `name: "500 g de lait"` contains a quantity.
         Move it: `{ qty: 500, unit: ml, name: lait }`
  [E101] `title` is missing and is required.

WARNINGS — fix if you can, the file will save without them:
  [W304] ingredients[0].items[1]: `name: "gros oignon"` may contain a size
         descriptor. Consider `{ name: oignon, note: gros }`
  [W401] no `## Préparation` section found.

--- YOUR FILE ---
<the rejected file, verbatim>
--- END FILE ---
```

Design choices that matter:

- **Stable numeric codes.** `E201` never changes meaning. Makes errors greppable,
  countable over time, and lets the prompt in `AI-TEMPLATE.md` be improved
  against whichever code fires most often.
- **Path, not line number.** `ingredients[0].items[3]` survives reformatting; a
  line number does not, and YAML reflow shifts every line.
- **Every error states the fix, not just the fault.** `[E210]` shows the corrected
  entry. An AI given the fix applies it; an AI given only a complaint improvises.
- **The full file is included.** The AI's own context may be gone, compacted, or a
  different session entirely. Self-contained block, always.
- **"Complete file, one fence, no explanation"** is repeated here even though it is
  in the original prompt, because that is the instruction most often lost by the
  second turn.
- **Errors and warnings separated**, with warnings explicitly marked non-blocking,
  so the AI does not restructure a valid file chasing a suggestion.

**Who fixes each code.** Every code in the tables below has a *Fixed by* column:

- `ai` — the AI that produced the file can fix it from the file and the source.
  These, and only these, go into the fix-request block.
- `app` — only the app or the person can settle it: it depends on the rest of the
  vault (slug collisions, duplicate titles, sub-recipes not added yet, the
  registry and vocabularies), on reading the photo (confirming a `[?]`), or on
  information the source may not have (servings, times, provenance — asking the
  AI invites it to invent them). These show in the app UI and in `vault check`
  output, never in the block.

A file whose only errors are `app` codes is left out of the block and listed with
the recipes the AI must not resend. **Adding a code means choosing its fixer**;
the checker's test suite fails on a code without one.

The block includes the spec only when an error suggests the AI never had it —
several `E2xx` at once, or the output not being markdown at all. Otherwise the
codes and fixes are enough, and pasting the whole of `AI-TEMPLATE.md` every time
wastes the AI's context on a one-line fix.

## Info

Not problems; shown so nothing is silent.

| Code | Fixed by | Condition |
|---|---|---|
| I701 | app | `[+]` present — text added by the transcriber, rendered distinctly |
| I702 | app | a `QUESTIONS` section or other text found outside the fences — ignored, shown to the user in case the AI asked something |

## Error codes

Hard errors. Refuse to save.

A value that *starts* with an unquoted marker (`name: [illisible]`) is read by
YAML as a list, not text. Whichever code fires on that field, its fix is the
same: wrap the value in double quotes (`name: "[illisible]"`).

Number fields take markers the way `qty` does: `qty`, `qty_max`, `servings`,
`servings_max`, `oven.temp` and `oven.temp_max` may be a quoted string such as
`"4 [?]"` or `"350 [?: 325]"`, and what is left once the markers are removed
must be valid for the field. A field that cannot hold text — `qty`, `qty_max`,
`unit` (of an ingredient, `alt` or `yield`), `source.type`, `times.*`,
`servings`, `servings_max`, `oven.temp`, `oven.temp_max` — holding *only* a
marker, quoted or not (`qty: [illisible]`, `type: "[?]"`), means nothing was
read. Quoting would not make it valid, so the fix is instead to leave the key
out (the whole amount for `qty`/`unit`, the whole `alt`, the whole `oven` for
`temp`) and ask in `QUESTIONS` — `AI-TEMPLATE.md` rule 4.

| Code | Fixed by | Condition |
|---|---|---|
| E001 | ai | not valid markdown with a YAML frontmatter block |
| E002 | ai | frontmatter is not valid YAML (include the YAML parser's own message) |
| E101 | ai | `title` missing |
| E102 | ai | `slug` is not lowercase ASCII hyphenated |
| E103 | app | `slug` already exists in the vault, or twice in one paste — resolved in the app: overwrite, or a suffixed slug (see `DATA-FLOW.md`) |
| E104 | ai | `lang` not `fr` or `en` |
| E105 | ai | `family` set without `variant`, or `variant` without `family` |
| E106 | ai | `source` is not a mapping, or `source.type` is present and not in the allowed list. `type` is optional: absent when the kind of source is not evident |
| E107 | ai | `difficulty` or `rating` outside 1–5 |
| E108 | ai | `servings` not a positive integer, or `servings_max` ≤ `servings` (markers aside: `"4 [?]"` is 4) |
| E109 | ai | `times.*` not in the duration format: `30m`, `1h`, `1h15m`, range `45m-50m` |
| E111 | ai | `oven.unit` not `F` or `C`, or `oven.temp` not a number (markers aside: `"350 [?]"` is 350), or `oven.temp_max` ≤ `oven.temp` |
| E112 | app | `status` or `added` written in a pasted file — the app sets these (auto-fixed on the paste path: stripped with a note, not rejected) |
| E113 | app | a vault file's `slug` does not match its file name (an edit outside the app) — the file is not indexed until the file is renamed or `slug` set back |
| E110 | ai | `schema` missing, or a version this app does not know |
| E200 | ai | `ingredients` missing or empty |
| E201 | ai | `unit` not in the canonical unit list — the message lists the Quebec abbreviation mapping (`tasse` → `cup`, `livre` → `lb`, `c. à thé` → `tsp`) |
| E202 | ai | `unit` present without `qty` |
| E203 | ai | `qty` present without `unit` |
| E204 | ai | `qty` neither a number nor a fraction string (`"1 1/2"`, `"2/3"`) |
| E205 | ai | `qty_max` present without `qty`, or `qty_max` ≤ `qty` |
| E206 | ai | `to_taste: true` together with `qty` or `unit` |
| E207 | ai | ingredient entry has no `name`, or `name` is not text |
| E208 | ai | `ingredients` is a flat list rather than groups with `items` |
| E209 | ai | duplicate ingredient `name` within one group |
| E210 | ai | `name` contains digits followed by a unit — quantity smuggled into the name |
| E211 | ai | `name` contains a comma and no `note`/`prep` — probably merged ingredients |
| E212 | ai | `buy_instead` present without `recipe` |
| E214 | ai | `alt` present without both `qty` and `unit` inside it, or with a key other than `qty`, `qty_max`, `unit` |
| E215 | ai | `or` not a list, or an entry that is neither a string nor a valid ingredient object (same rules as any ingredient entry, `name` required) |
| E216 | ai | a quantity and unit found inside `note` (`note: 2 lbs`) — should be `qty`/`unit`. Not fired when `unit` is a count or container unit (`piece`, `clove`, `leaf`, `sprig`, `stalk`, `bunch`, `slice`, `can`, `packet`, `bottle`, `jar`, `bag`) and the note holds a single size (`796 ml`, `environ 450 g`) — or one size followed by its equivalent in another unit in parentheses (`19 oz (540 ml)`, `540 ml (19 oz)`), as Canadian cans print it. Always fired when `unit` is absent or a measure, when the note holds any other second amount (two sizes, `796 ml (540 ml)`), or when it gives an alternative (`ou`/`or` + a quantity — that belongs in `or`) |
| E217 | ai | an unknown bracket marker — only `[?]`, `[?: …]`, `[illisible]`, `[+]` are allowed. Also catches prose uncertainty (`lecture incertaine`, `incertain`) and asks for `[?]` |
| E218 | ai | a field of the wrong shape. A text field (`note`, `prep`, `brand`, `recipe`, `group`, `source.author`, a tag, …) holds a list, a mapping or `true`/`false` — usually a value starting with an unquoted marker (`note: [illisible]`); fixed by quoting it. Or a list field (`tags`, `season`) or the `media` mapping holds a single value (`tags: dessert`, `media: final.jpg`); fixed by writing the list or mapping (`tags: [dessert]`, `media: { final: final.jpg }`). Fields with their own code (`title` E101, `name` E207, `qty` E204) keep it |
| E213 | ai | sub-recipe cycle — `A` uses `B` uses `A` |
| E301 | ai | a body heading is unrecognized *and* no recognized method heading exists |

Warnings. Save, mark `needs-review`.

| Code | Fixed by | Condition |
|---|---|---|
| W302 | ai | `name` ends in a known preparation participle (`émincé`, `râpé`, `haché`) |
| W303 | app | `name` matches no registry alias and fuzzy matching found no candidate |
| W304 | ai | `name` starts with a known size descriptor (`gros`, `petit`, `grande`) |
| W305 | app | ingredient resolved by fuzzy match rather than exact alias — confirm |
| W306 | app | `recipe:` points at a slug not in the vault yet |
| W401 | ai | no method section in the body |
| W402 | ai | a step exceeds ~400 characters — probably several steps merged |
| W501 | app | tag not in the vocabulary, closest canonical suggested |
| W502 | app | `family` within edit distance 2 of an existing family — drift suspected |
| W503 | app | near-identical `title` already in the vault — duplicate paste |
| W504 | ai | a `season` value not in the fixed list of `VOCAB.md` — `printemps`, `ete`, `automne`, `hiver` or one of their aliases (`été`, `summer`, `fall`, …); the closest season is suggested |
| W601 | app | no `servings` |
| W602 | app | no `times` |
| W603 | app | no dish photo |
| W604 | app | `source` entirely absent — provenance lost |
| W605 | app | `[?]`, `[?: …]`, or `[illisible]` present — each location listed |
| W606 | ai | `to_taste: true` on something the registry does not class as seasoning or fat — probably should be a plain name without amount |
| W607 | ai | `name` contains a word from the known-brands list — suggest `brand:` |
| W608 | app | same title as an existing recipe — offer to make both members of a family |
| W609 | ai | step text mentions an oven temperature but `oven` is absent |
| W610 | ai | unknown frontmatter key (`serving:`, `temps:`), in the frontmatter or inside `source`, `times`, `oven`, `yield`, `media`, a group or an ingredient entry — its value is ignored; the closest allowed key is suggested |

`E210` and `E211` are heuristics, deliberately hard errors rather than warnings.
They catch the two AI mistakes that quietly corrupt the ingredient index, and a
false positive costs one manual override — far cheaper than discovering at recipe
800 that the pantry search has been splitting onions in two the whole time.

## Several recipes in one paste

One photo can hold several recipes, so the AI may return several fenced files in
one answer. The paste box accepts that: each fence is validated and saved as its
own recipe. The fix-request block then covers only the failing ones, each with its
own file included, and says which recipes already saved so the AI does not resend
them.

## Human-facing validation

Her form UI never shows any of this. Codes and fix-request blocks exist for the
paste path. The form prevents these states structurally —
ingredient rows have separate `qty`, `unit`, `name`, `note`, `prep` inputs, so
`E210` and `E211` cannot be expressed in the first place.
