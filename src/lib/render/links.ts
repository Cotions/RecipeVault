// Where an ingredient name links (plan 03, Phase 5). Browser-safe.

/** The ingredient view (plan 03, Phase 6). Slugs are lowercase ASCII and hyphens: no escaping. */
export const ingredientHref = (slug: string) => `/ingredients/${slug}`;

/** Its row in the ingredient index, where a price is entered. */
export const ingredientRowHref = (slug: string) => `/ingredients#i-${slug}`;

/**
 * The id of a key's row in the resolve queue. Keys are folded (lowercase, no
 * accents); anything but a letter or digit becomes `-`, so the id needs no
 * escaping in a URL or a selector. Two keys differing only in punctuation share
 * an id: the link then lands on the first, next to the other.
 */
export const queueRowId = (key: string) => `k-${key.replace(/[^\p{L}\p{N}]+/gu, '-')}`;

/** A key's row in the resolve queue: `cle` makes the page show it even beyond the first page. */
export const queueHref = (key: string) => `/resoudre?cle=${encodeURIComponent(key)}#${queueRowId(key)}`;
