// Oven temperatures in both units: old Québec cards are all °F.

import type { Oven } from '../vault/types';

/** °F → °C, rounded to 10 like an oven dial: 350 → 180. */
export const toC = (f: number) => Math.round(((f - 32) * 5) / 9 / 10) * 10;
/** °C → °F, rounded to 25: 180 → 350. */
export const toF = (c: number) => Math.round(((c * 9) / 5 + 32) / 25) * 25;

/** One temperature when both ends round alike (350–360 °F is 180 °C, not 180–180 °C). */
function range(a: number, b: number | undefined, unit: string): string {
	return b && b !== a ? `${a}–${b} ${unit}` : `${a} ${unit}`;
}

/** `350 °F · 180 °C` (the written unit first). */
export function formatOven(o: Oven): { written: string; converted: string } {
	if (o.unit === 'F')
		return { written: range(o.temp, o.tempMax, '°F'), converted: range(toC(o.temp), o.tempMax ? toC(o.tempMax) : undefined, '°C') };
	return { written: range(o.temp, o.tempMax, '°C'), converted: range(toF(o.temp), o.tempMax ? toF(o.tempMax) : undefined, '°F') };
}
