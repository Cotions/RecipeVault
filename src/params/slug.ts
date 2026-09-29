import type { ParamMatcher } from '@sveltejs/kit';
import { SLUG_RE } from '../lib/vault/slug';

// A recipe, family or ingredient slug: lowercase ASCII and hyphens, nothing
// that could climb out of its folder (`..%2F` decodes to `../` in a param).
// Used by `hooks.server.ts` for every `[slug]` route, and as `[slug=slug]`.
export const match = ((param: string): param is string => SLUG_RE.test(param)) satisfies ParamMatcher;
