import type { ParamMatcher } from '@sveltejs/kit';
import { SLUG_RE } from '../lib/vault/slug';

// A recipe, family or ingredient slug: lowercase ASCII and hyphens, nothing
// that could climb out of its folder (`..%2F` decodes to `../` in a param).
// Every slug route is `[slug=slug]`; `hooks.server.ts` checks `params.slug`
// again, in case a route is added without the matcher.
export const match = ((param: string): param is string => SLUG_RE.test(param)) satisfies ParamMatcher;
