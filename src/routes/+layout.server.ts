import { getApp } from '$lib/server/app';
import { queueCount } from '$lib/server/queue';
import type { LayoutServerLoad } from './$types';

// The nav's "À relier (N)" entry (plan 03, Phase 3): shown once N > 0.
export const load: LayoutServerLoad = () => ({ toResolve: queueCount(getApp().ctx.db) });
