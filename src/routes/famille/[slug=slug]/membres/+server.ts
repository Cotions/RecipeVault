import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { familyNames } from '$lib/server/index/query';
import { stripMarkers } from '$lib/vault/markers';
import type { RequestHandler } from './$types';

// A group's recipes, for the form's « Elle rejoindra : … » before a save
// (FamilyPicker): its name and each recipe's title, variant and author. A
// read of what /famille/<slug> shows already; an unknown group: no recipes.
export const GET: RequestHandler = ({ params }) => {
	const db = getApp().ctx.db;
	const rows = db.prepare('SELECT slug, title, variant, author FROM recipes WHERE family = ? ORDER BY title_sort').all(params.slug) as {
		slug: string;
		title: string;
		variant: string | null;
		author: string | null;
	}[];
	return json({
		name: familyNames(db, [params.slug])[params.slug] ?? null,
		members: rows.map((r) => ({
			slug: r.slug,
			title: stripMarkers(r.title),
			variant: r.variant ? stripMarkers(r.variant) : null,
			author: r.author ? stripMarkers(r.author) : null
		}))
	});
};
