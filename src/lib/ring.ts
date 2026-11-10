// The kitchen timer's alarm, shared by kitchen mode and the layout's cook chip
// (a timer that rings while she reads another page). Browser only; silent
// where there is no audio (or before any tap: browsers keep a page mute until
// it has had one, so the chip rings only after a tap in this tab, which coming
// back from kitchen mode always is).

/** One context for the app's life (browsers cap live ones): kitchen mode and the chip share it. */
let audio: AudioContext | null = null;

/** The context, made on first use; null where there is no Web Audio. */
function context(): AudioContext | null {
	try {
		audio ??= new AudioContext();
		if (audio.state === 'suspended') audio.resume().catch(() => {});
		return audio;
	} catch {
		return null;
	}
}

/** Called from a tap: the audio unlocked then can play the alarm later. */
export function unlockAudio(): void {
	context();
}

/** Three beeps and a buzz (a timer done); `soft`: one low beep, no buzz (a range's « vérifier »). */
export function ring(soft = false): void {
	const a = context();
	if (a) {
		try {
			const n = soft ? 1 : 3;
			for (let i = 0; i < n; i++) {
				const o = a.createOscillator();
				const g = a.createGain();
				o.frequency.value = soft ? 660 : 880;
				g.gain.setValueAtTime(0.0001, a.currentTime + i * 0.5);
				g.gain.exponentialRampToValueAtTime(soft ? 0.25 : 0.4, a.currentTime + i * 0.5 + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + i * 0.5 + 0.35);
				o.connect(g).connect(a.destination);
				o.start(a.currentTime + i * 0.5);
				o.stop(a.currentTime + i * 0.5 + 0.4);
			}
		} catch {
			// no sound available
		}
	}
	if (!soft) navigator.vibrate?.([400, 200, 400, 200, 400]);
	else navigator.vibrate?.(200);
}

