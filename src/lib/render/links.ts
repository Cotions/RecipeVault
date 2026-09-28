// Where an ingredient name links (plan 03, Phase 5). Browser-safe.

/** Its row in the ingredient index; the ingredient view (/ingredients/<slug>) is Phase 6. */
export const ingredientHref = (slug: string) => `/ingredients#i-${slug}`;

/**
 * The id of a key's row in the resolve queue. Keys are folded (lowercase, no
 * accents); anything but a letter or digit becomes `-`, so the id needs no
 * escaping in a URL or a selector. Two keys differing only in punctuation share
 * an id: the link then lands on the first, next to the other.
 */
export const queueRowId = (key: string) => `k-${key.replace(/[^\p{L}\p{N}]+/gu, '-')}`;

export const queueHref = (key: string) => `/resoudre#${queueRowId(key)}`;
