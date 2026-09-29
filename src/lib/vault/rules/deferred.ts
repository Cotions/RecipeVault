// Rules not implemented yet, each with the reason. Listed here so none is
// forgotten. W302, W304, W501, W502, W606 and W607 were turned on by plan 03,
// Phase 8, once the vault's word lists, vocabularies and ingredient registry
// existed.

export const DEFERRED_RULES = {
	W603: 'no dish photo — kept deferred (plan 04, Q13 A): most recipes never get one, so it would sit on nearly all of them; the recipe page shows an "Ajouter une photo" prompt instead'
} as const;
