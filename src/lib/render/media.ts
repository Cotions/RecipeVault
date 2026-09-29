// URLs of a dish photo's derived copies (plan 04, Phase 6). Browser-safe: the
// cards build them from the index row. The original is never linked.

export type PhotoVariant = 'thumb' | 'display';

/** HEIC/HEIF originals have no derived copy: shown as a placeholder. */
export const isHeicName = (file: string) => /\.hei[cf]$/i.test(file);

/** `/media/<slug>/<file>?v=…`, or null for a HEIC original. */
export function photoSrc(slug: string, file: string, v: PhotoVariant): string | null {
	if (isHeicName(file)) return null;
	return `/media/${slug}/${encodeURIComponent(file)}?v=${v}`;
}
