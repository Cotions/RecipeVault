import { getApp } from '$lib/server/app';
import { queueCount } from '$lib/server/queue';
import { pendingTagCount, tagLabels } from '$lib/server/tags';
import { loadUnitWords } from '$lib/server/vocab';
import type { LayoutServerLoad } from './$types';

// The nav's "À relier (N)" entry (plan 03, Phase 3) and "Étiquettes (N)"
// (plan 04, Phase 8): shown once N > 0, to an account with the Markdown tools
// (plan 04, Q2 B). Tag labels (vocab/tag-labels.yaml) for every page that
// shows a tag. The signed-in person: name and that preference, never the
// email or anything else from users.json. The unit words
// (vocab/unit-labels.yaml, plan 05) for every page that shows an amount.
export const load: LayoutServerLoad = ({ locals }) => ({
	toResolve: queueCount(getApp().ctx.db),
	pendingTags: pendingTagCount(getApp().ctx.db),
	tagLabels: tagLabels(getApp().ctx),
	unitWords: loadUnitWords(getApp().ctx.paths.vocab),
	user: locals.user ? { login: locals.user.login, name: locals.user.name, markdown: !!locals.user.markdown } : null
});
