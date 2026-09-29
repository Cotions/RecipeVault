<script lang="ts" module>
	export interface Option {
		value: string;
		label: string;
		/** A small line after the label ("3 recettes", "relié"). */
		meta?: string;
		/** A special entry (a new family, a new tag): drawn apart. */
		special?: boolean;
	}
</script>

<script lang="ts">
	// A text field with suggestions under it (plan 04, Q8 A): an ARIA combobox,
	// keyboard and touch. The suggestions come from `load` (the server, or a
	// list the page has); picking one calls `onpick`. Typing stays free: a
	// value not in the list is kept as she typed it.
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		value = $bindable(''),
		load,
		onpick,
		onenter,
		oninput,
		onblur,
		id,
		label,
		placeholder,
		invalid = false,
		describedby,
		inputmode,
		autocapitalize = 'sentences',
		testid,
		input = $bindable()
	}: {
		value?: string;
		load: (q: string) => Option[] | Promise<Option[]>;
		onpick: (o: Option) => void;
		/** Enter with no suggestion chosen. */
		onenter?: () => void;
		oninput?: (v: string) => void;
		onblur?: () => void;
		id: string;
		label?: string;
		placeholder?: string;
		invalid?: boolean;
		describedby?: string;
		inputmode?: HTMLInputAttributes['inputmode'];
		autocapitalize?: HTMLInputAttributes['autocapitalize'];
		testid?: string;
		input?: HTMLInputElement;
	} = $props();

	let options = $state<Option[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const listId = $derived(`${id}-list`);

	function refresh(q: string, now = false) {
		clearTimeout(timer);
		const run = async () => {
			const mine = ++seq;
			try {
				const got = await load(q);
				if (mine !== seq) return;
				options = got;
				active = -1;
				open = got.length > 0 && document.activeElement === input;
			} catch {
				/* offline: no suggestions, the field still works */
			}
		};
		if (now) run();
		else timer = setTimeout(run, 150);
	}

	function pick(o: Option) {
		open = false;
		active = -1;
		onpick(o);
	}

	function keydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' && options.length) {
			e.preventDefault();
			open = true;
			active = (active + 1) % options.length;
		} else if (e.key === 'ArrowUp' && open) {
			e.preventDefault();
			active = active <= 0 ? options.length - 1 : active - 1;
		} else if (e.key === 'Enter') {
			if (open && active >= 0) {
				e.preventDefault();
				pick(options[active]);
			} else if (onenter) {
				e.preventDefault();
				open = false;
				onenter();
			}
		} else if (e.key === 'Escape' && open) {
			e.preventDefault();
			open = false;
		}
	}
</script>

<div class="suggest">
	{#if label}<label for={id}>{label}</label>{/if}
	<input
		bind:this={input}
		{id}
		type="text"
		role="combobox"
		autocomplete="off"
		{autocapitalize}
		{inputmode}
		{placeholder}
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={listId}
		aria-activedescendant={open && active >= 0 ? `${id}-o${active}` : undefined}
		aria-invalid={invalid || undefined}
		aria-describedby={describedby}
		data-testid={testid}
		bind:value
		oninput={() => {
			oninput?.(value);
			refresh(value);
		}}
		onfocus={() => refresh(value, true)}
		onblur={() => {
			// Let a tap on a suggestion land first.
			setTimeout(() => (open = false), 150);
			onblur?.();
		}}
		onkeydown={keydown}
	/>
	<ul id={listId} role="listbox" hidden={!open}>
		{#each options as o, i (o.value + i)}
			<li
				id="{id}-o{i}"
				role="option"
				aria-selected={i === active}
				class:special={o.special}
				onpointerdown={(e) => {
					e.preventDefault();
					pick(o);
				}}
			>
				<span>{o.label}</span>
				{#if o.meta}<small>{o.meta}</small>{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.suggest {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	input {
		width: 100%;
		min-height: 44px;
	}
	input[aria-invalid='true'] {
		border-color: var(--rule-red);
	}
	label {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	ul {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 20;
		margin: 2px 0 0;
		padding: 0.25rem 0;
		list-style: none;
		background: var(--card);
		border: 1.5px solid var(--ink);
		border-radius: var(--radius);
		box-shadow: 0 6px 18px rgba(28, 42, 66, 0.18);
		max-height: 16rem;
		overflow-y: auto;
	}
	li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 44px;
		padding: 0.55rem 0.75rem;
		cursor: pointer;
	}
	li[aria-selected='true'],
	li:hover {
		background: #eef2f7;
	}
	li.special {
		border-top: 1px dashed var(--line);
		font-weight: 600;
		color: var(--link);
	}
	small {
		color: var(--ink-soft);
		white-space: nowrap;
	}
</style>
