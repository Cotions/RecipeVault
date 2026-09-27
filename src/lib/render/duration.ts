// Durations for display: 5400 s → "1 h 30".

import type { Duration, Lang } from '../vault/types';

export function formatSeconds(s: number, lang: Lang = 'fr'): string {
	const min = Math.round(s / 60);
	const h = Math.floor(min / 60);
	const m = min % 60;
	if (!h) return `${m} min`;
	if (!m) return `${h} h`;
	return lang === 'fr' ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h ${m} min`;
}

export function formatDurationValue(d: Duration, lang: Lang = 'fr'): string {
	if (d.maxSeconds) {
		const a = formatSeconds(d.seconds, lang);
		const b = formatSeconds(d.maxSeconds, lang);
		// "45–50 min" rather than "45 min–50 min"
		const unitA = a.replace(/^[\d\s]+/, '');
		const unitB = b.replace(/^[\d\s]+/, '');
		if (unitA === 'min' && unitB === 'min') return `${a.replace(' min', '')}–${b}`;
		return `${a} à ${b}`.replace(' à ', lang === 'fr' ? ' à ' : ' to ');
	}
	return formatSeconds(d.seconds, lang);
}
