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
         Allowed units: g, kg, ml, cl, l, tbsp, tsp, pinch, drop, piece, clove,
         leaf, sprig, bunch, slice, can, packet
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

The block includes the spec only when an error suggests the AI never had it —
several `E2xx` at once, or the output not being markdown at all. Otherwise the
codes and fixes are enough, and pasting the whole of `AI-TEMPLATE.md` every time
wastes the AI's context on a one-line fix.

## Info

Not problems; shown so nothing is silent.

| Code | Condition |
|---|---|
| I701 | `[+]` present — text added by the transcriber, rendered distinctly |
| I702 | a `QUESTIONS` section or other text found outside the fences — ignored, shown to the user in case the AI asked something |

## Error codes

Hard errors. Refuse to save.

| Code | Condition |
|---|---|
| E001 | not valid markdown with a YAML frontmatter block |
| E002 | frontmatter is not valid YAML (include the YAML parser's own message) |
| E101 | `title` missing |
| E102 | `slug` is not lowercase ASCII hyphenated |
| E103 | `slug` already exists in the vault |
| E104 | `lang` not `fr` or `en` |
| E105 | `family` set without `variant`, or `variant` without `family` |
| E106 | `source.type` not in the allowed list |
| E107 | `difficulty` or `rating` outside 1–5 |
| E108 | `servings` not a positive integer, or `servings_max` ≤ `servings` |
| E109 | `times.*` not in the duration format: `30m`, `1h`, `1h15m`, range `45m-50m` |
| E111 | `oven.unit` not `F` or `C`, or `oven.temp` not a number |
| E112 | `status` or `added` written in a pasted file — the app sets these (auto-fixed on the paste path: stripped with a note, not rejected) |
| E110 | `schema` missing, or a version this app does not know |
| E200 | `ingredients` missing or empty |
| E201 | `unit` not in the canonical unit list — the message lists the Quebec abbreviation mapping (`tasse` → `cup`, `livre` → `lb`, `c. à thé` → `tsp`) |
| E202 | `unit` present without `qty` |
| E203 | `qty` present without `unit` |
| E204 | `qty` neither a number nor a fraction string (`"1 1/2"`, `"2/3"`) |
| E205 | `qty_max` present without `qty`, or `qty_max` ≤ `qty` |
| E206 | `to_taste: true` together with `qty` or `unit` |
| E207 | ingredient entry has no `name` |
| E208 | `ingredients` is a flat list rather than groups with `items` |
| E209 | duplicate ingredient `name` within one group |
| E210 | `name` contains digits followed by a unit — quantity smuggled into the name |
| E211 | `name` contains a comma and no `note`/`prep` — probably merged ingredients |
| E212 | `buy_instead` present without `recipe` |
| E214 | `alt` present without both `qty` and `unit` inside it, or with a key other than `qty`, `qty_max`, `unit` |
| E215 | `or` not a list, or an entry that is neither a string nor a valid ingredient object (same rules as any ingredient entry, `name` required) |
| E216 | a quantity and unit found inside `note` (`note: 2 lbs`) — should be `qty`/`unit` |
| E217 | an unknown bracket marker — only `[?]`, `[?: …]`, `[illisible]`, `[+]` are allowed. Also catches prose uncertainty (`lecture incertaine`, `incertain`) and asks for `[?]` |
| E213 | sub-recipe cycle — `A` uses `B` uses `A` |
| E301 | a body heading is unrecognized *and* no recognized method heading exists |

Warnings. Save, mark `needs-review`.

| Code | Condition |
|---|---|
| W302 | `name` ends in a known preparation participle (`émincé`, `râpé`, `haché`) |
| W303 | `name` matches no registry alias and fuzzy matching found no candidate |
| W304 | `name` starts with a known size descriptor (`gros`, `petit`, `grande`) |
| W305 | ingredient resolved by fuzzy match rather than exact alias — confirm |
| W306 | `recipe:` points at a slug not in the vault yet |
| W401 | no method section in the body |
| W402 | a step exceeds ~400 characters — probably several steps merged |
| W501 | tag not in the vocabulary, closest canonical suggested |
| W502 | `family` within edit distance 2 of an existing family — drift suspected |
| W503 | near-identical `title` already in the vault — duplicate paste |
| W601 | no `servings` |
| W602 | no `times` |
| W603 | no dish photo |
| W604 | `source` entirely absent — provenance lost |
| W605 | `[?]`, `[?: …]`, or `[illisible]` present — each location listed |
| W606 | `to_taste: true` on something the registry does not class as seasoning or fat — probably should be a plain name without amount |
| W607 | `name` contains a word from the known-brands list — suggest `brand:` |
| W608 | same title as an existing recipe — offer to make both members of a family |
| W609 | step text mentions an oven temperature but `oven` is absent |
| W610 | unknown frontmatter key (`serving:`, `temps:`), in the frontmatter or inside `source`, `times`, `oven`, `yield`, `media`, a group or an ingredient entry — its value is ignored; the closest allowed key is suggested |

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
