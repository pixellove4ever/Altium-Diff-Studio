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
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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
</div>

<style>
	.svg-pan-zoom-container {
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
</style>
