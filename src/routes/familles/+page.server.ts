import { getApp } from '$lib/server/app';
import { families } from '$lib/server/index/query';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ families: families(getApp().ctx.db) });
