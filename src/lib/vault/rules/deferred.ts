// Rules not implemented yet. Each needs vault data that does not exist yet —
// the ingredient registry (`ingredients/`) or the live vocabularies (`vocab/`) —
// and belongs to the ingredient-registry plan. Listed here so none is forgotten.

export const DEFERRED_RULES = {
	W302: '`name` ends in a known preparation participle — needs the participle list from vocab/',
	W304: '`name` starts with a known size descriptor — needs the descriptor list from vocab/',
	W501: 'tag not in the vocabulary — needs vocab/tags.yaml',
	W502: '`family` near an existing family — needs vocab/families.yaml',
	W603: 'no dish photo — needs media/; meaningless on the paste path, where there never is one',
	W606: '`to_taste` on something not classed as seasoning or fat — needs ingredients/',
	W607: '`name` contains a known brand — needs the brand list'
} as const;
