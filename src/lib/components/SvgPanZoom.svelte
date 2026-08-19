<script lang="ts">
	import type { Snippet } from 'svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';

	let {
		viewBox,
		ariaLabel = '',
		children,
		class: className = ''
	}: {
		viewBox: string;
		ariaLabel?: string;
		children: Snippet;
		class?: string;
	} = $props();

	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);
	let isDragging = false;
	let lastX = 0;
	let lastY = 0;

	function fitView() {
		zoom = 1;
		panX = 0;
		panY = 0;
	}

	function zoomIn() {
		zoom = Math.min(100, zoom * 1.25);
	}

	function zoomOut() {
		zoom = Math.max(0.1, zoom / 1.25);
	}

	export function reset() {
		fitView();
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const nextZoom = Math.min(100, Math.max(0.1, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));

		const worldX = (mouseX - panX) / zoom;
		const worldY = (mouseY - panY) / zoom;

		zoom = nextZoom;
		panX = mouseX - worldX * nextZoom;
		panY = mouseY - worldY * nextZoom;
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 && e.button !== 1) return;
		if ((e.target as HTMLElement).closest('.pan-zoom-controls')) return;
		isDragging = true;
		lastX = e.clientX;
		lastY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		panX += e.clientX - lastX;
		panY += e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
	}

	function onPointerUp(e: PointerEvent) {
		isDragging = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// ignore pointer capture errors if lost
		}
	}

	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		fitView();
	}

	// Reset when viewBox changes (e.g., when layer changes)
	$effect(() => {
		viewBox; // track
		fitView();
	});
</script>

<div
	class={`svg-pan-zoom-container ${className}`}
	onwheel={onWheel}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	oncontextmenu={onContextMenu}
	role="region"
	aria-label={ariaLabel}
	title={localeStore.t('app.mouseWheelZoom')}
>
	<svg
		{viewBox}
		aria-hidden="true"
		style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: top left;"
	>
		{@render children()}
	</svg>
	<div class="pan-zoom-controls no-print" role="toolbar" aria-label="Contrôles de zoom">
		<button
			type="button"
			class="zoom-btn"
			onclick={(e) => {
				e.stopPropagation();
				zoomIn();
			}}
			title="Zoom +"
		>
			+
		</button>
		<button
			type="button"
			class="zoom-btn"
			onclick={(e) => {
				e.stopPropagation();
				zoomOut();
			}}
			title="Zoom -"
		>
			−
		</button>
		<button
			type="button"
			class="zoom-btn fit-btn"
			onclick={(e) => {
				e.stopPropagation();
				fitView();
			}}
			title="Ajuster l'affichage (Fit)"
		>
			Fit
		</button>
	</div>
</div>

<style>
	.svg-pan-zoom-container {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		touch-action: none;
		cursor: grab;
	}
	.svg-pan-zoom-container:active {
		cursor: grabbing;
	}
	svg {
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.pan-zoom-controls {
		position: absolute;
		bottom: 16px;
		right: 16px;
		display: flex;
		align-items: center;
		gap: 2px;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(6px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		padding: 3px 4px;
		z-index: 10;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		pointer-events: auto;
	}

	.zoom-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 26px;
		padding: 0 6px;
		font-size: 13px;
		font-weight: 700;
		color: #f8fafc;
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
		line-height: 1;
	}

	.zoom-btn:hover {
		background: rgba(255, 255, 255, 0.2);
		color: #ffffff;
	}

	.fit-btn {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0 8px;
		margin-left: 2px;
		border-left: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 0 5px 5px 0;
	}
</style>
