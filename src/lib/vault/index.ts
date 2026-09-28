// Public API of the recipe checker. Browser-safe: no Node-only imports.

export type * from './types';
export { UNITS } from './types';
export { splitPaste, type SplitPaste } from './fences';
export { parseRecipe, type ParsedFile } from './parse';
export {
	checkRecipe,
	checkBatch,
	checkPaste,
	addOutsideText,
	hasErrors,
	sortDiagnostics,
	summarize,
	type CheckResult,
	type BatchResult,
	type BatchFileResult,
	type BatchOptions,
	type CheckOptions
} from './check';
export { parseWordList, type CheckWords, type WordList } from './words';
export { vocabDiagnostics, type VaultVocabOptions } from './rules/vaultvocab';
export { CODE_FIXERS, fixerOf, type Fixer } from './codes';
export { renderFixBlock, needsSpec, aiErrors, aiDiagnostics, type FailedFile, type FixBlockOptions } from './fixblock';
export { vaultEntryFor, type VaultEntry } from './rules/batch';
export { DEFERRED_RULES } from './rules/deferred';
export { normalizeText } from './normalize';
export { slugify } from './slug';
export { parseQuantity } from './quantity';
export { parseDuration } from './duration';
export { findMarkers, stripMarkers } from './markers';
