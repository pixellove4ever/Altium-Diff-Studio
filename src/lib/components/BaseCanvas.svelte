<script lang="ts">
	import { onMount } from 'svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';

	export type DrawContext = {
		ctx: CanvasRenderingContext2D;
		width: number;
		height: number;
		zoom: number;
		panX: number;
		panY: number;
	};

	export type ClipRect = {
		x: number;
		y: number;
		width: number;
		height: number;
	};

	export type CanvasClick = DrawContext & {
		x: number;
		y: number;
	};

	export type CanvasPerformanceMetric = {
		kind: 'render' | 'hit-test';
		durationMs: number;
	};

	let {
		background = '#ffffff',
		draw,
		clipRect,
		syncZoom = $bindable(1),
		syncPanX = $bindable(0),
		syncPanY = $bindable(0),
		synced = false,
		showHud = true,
		ariaLabel = 'Interactive design canvas',
		onCanvasClick,
		onCanvasLeave,
		resolveTooltip,
		focusKey,
		redrawKey,
		resolveFocus,
		onPerformanceMetric
	}: {
		background?: string;
		draw?: (context: DrawContext) => void;
		clipRect?: ClipRect;
		syncZoom?: number;
		syncPanX?: number;
		syncPanY?: number;
		synced?: boolean;
		showHud?: boolean;
		ariaLabel?: string;
		onCanvasClick?: (event: CanvasClick) => void;
		onCanvasLeave?: () => void;
		resolveTooltip?: (event: CanvasClick) => string | null;
		focusKey?: string | null;
		redrawKey?: unknown;
		resolveFocus?: (
			width: number,
			height: number
		) => { x: number; y: number; zoom?: number } | null;
		onPerformanceMetric?: (metric: CanvasPerformanceMetric) => void;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let localZoom = $state(1);
	let localPanX = $state(0);
	let localPanY = $state(0);
	let isDragging = $state(false);
	let lastX = $state(0);
	let lastY = $state(0);
	let downX = $state(0);
	let downY = $state(0);
	let width = $state(1);
	let height = $state(1);
	let tooltip = $state<{ x: number; y: number; text: string } | null>(null);
	let tooltipFrame: number | null = null;
	let pendingTooltipPoint: { x: number; y: number } | null = null;

	// When synced, use synced values; otherwise use local state
	const zoom = $derived(synced ? syncZoom : localZoom);
	const panX = $derived(synced ? syncPanX : localPanX);
	const panY = $derived(synced ? syncPanY : localPanY);

	function setZoom(value: number) {
		if (synced) {
			syncZoom = value;
		} else {
			localZoom = value;
		}
	}

	function setPanX(value: number) {
		if (synced) {
			syncPanX = value;
		} else {
			localPanX = value;
		}
	}

	function setPanY(value: number) {
		if (synced) {
			syncPanY = value;
		} else {
			localPanY = value;
		}
	}

	function render() {
		if (!canvas) return;

		const startedAt = performance.now();
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const ratio = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		width = Math.max(1, Math.floor(rect.width));
		height = Math.max(1, Math.floor(rect.height));
		const pixelWidth = Math.floor(width * ratio);
		const pixelHeight = Math.floor(height * ratio);
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
		}

		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, width, height);

		ctx.save();

		// Apply optional clipping rectangle
		if (clipRect) {
			ctx.beginPath();
			ctx.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
			ctx.clip();
		}

		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);
		draw?.({ ctx, width, height, zoom, panX, panY });
		ctx.restore();
		onPerformanceMetric?.({ kind: 'render', durationMs: performance.now() - startedAt });
	}

	function onPointerDown(event: PointerEvent) {
		isDragging = true;
		clearTooltip();
		lastX = event.clientX;
		lastY = event.clientY;
		downX = event.clientX;
		downY = event.clientY;
		canvas?.setPointerCapture(event.pointerId);
	}

	function clearTooltip() {
		tooltip = null;
		pendingTooltipPoint = null;
		onCanvasLeave?.();
		if (tooltipFrame !== null) {
			cancelAnimationFrame(tooltipFrame);
			tooltipFrame = null;
		}
	}

	function onPointerMove(event: PointerEvent) {
		if (!isDragging) {
			if (!canvas || !resolveTooltip) return;
			const rect = canvas.getBoundingClientRect();
			pendingTooltipPoint = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top
			};
			if (tooltipFrame !== null) return;
			tooltipFrame = requestAnimationFrame(() => {
				tooltipFrame = null;
				if (!canvas || !resolveTooltip || !pendingTooltipPoint) return;
				const point = {
					ctx: canvas.getContext('2d')!,
					width,
					height,
					zoom,
					panX,
					panY,
					...pendingTooltipPoint
				};
				pendingTooltipPoint = null;
				const startedAt = performance.now();
				const text = resolveTooltip(point);
				onPerformanceMetric?.({
					kind: 'hit-test',
					durationMs: performance.now() - startedAt
				});
				tooltip = text ? { x: point.x, y: point.y, text } : null;
			});
			return;
		}

		setPanX(panX + event.clientX - lastX);
		setPanY(panY + event.clientY - lastY);
		lastX = event.clientX;
		lastY = event.clientY;
	}

	function onPointerUp(event: PointerEvent) {
		isDragging = false;
		canvas?.releasePointerCapture(event.pointerId);
		if (!canvas || Math.hypot(event.clientX - downX, event.clientY - downY) > 4) return;
		const rect = canvas.getBoundingClientRect();
		onCanvasClick?.({
			ctx: canvas.getContext('2d')!,
			width,
			height,
			zoom,
			panX,
			panY,
			x: event.clientX - rect.left,
			y: event.clientY - rect.top
		});
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		if (!canvas) return;

		const rect = canvas.getBoundingClientRect();
		const mouseX = event.clientX - rect.left;
		const mouseY = event.clientY - rect.top;
		const nextZoom = Math.min(12, Math.max(0.08, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
		const worldX = (mouseX - panX) / zoom;
		const worldY = (mouseY - panY) / zoom;

		setZoom(nextZoom);
		setPanX(mouseX - worldX * nextZoom);
		setPanY(mouseY - worldY * nextZoom);
	}

	function zoomFromCenter(factor: number) {
		const nextZoom = Math.min(12, Math.max(0.08, zoom * factor));
		const worldX = (width / 2 - panX) / zoom;
		const worldY = (height / 2 - panY) / zoom;
		setZoom(nextZoom);
		setPanX(width / 2 - worldX * nextZoom);
		setPanY(height / 2 - worldY * nextZoom);
	}

	function fitView() {
		setZoom(1);
		setPanX(0);
		setPanY(0);
	}

	function onCanvasKeyDown(event: KeyboardEvent) {
		const step = event.shiftKey ? 80 : 32;
		if (event.key === '+' || event.key === '=') zoomFromCenter(1.25);
		else if (event.key === '-') zoomFromCenter(0.8);
		else if (event.key === '0') fitView();
		else if (event.key === 'ArrowLeft') setPanX(panX + step);
		else if (event.key === 'ArrowRight') setPanX(panX - step);
		else if (event.key === 'ArrowUp') setPanY(panY + step);
		else if (event.key === 'ArrowDown') setPanY(panY - step);
		else return;
		event.preventDefault();
	}

	onMount(() => {
		const observer = new ResizeObserver(render);
		if (canvas) observer.observe(canvas);

		return () => {
			observer.disconnect();
			if (tooltipFrame !== null) cancelAnimationFrame(tooltipFrame);
		};
	});

	$effect(() => {
		zoom;
		panX;
		panY;
		draw;
		background;
		clipRect;
		redrawKey;
		render();
	});

	$effect(() => {
		if (!focusKey || !resolveFocus || width <= 1 || height <= 1) return;
		const target = resolveFocus(width, height);
		if (!target) return;
		const nextZoom = Math.min(12, Math.max(1, target.zoom ?? 3));
		setZoom(nextZoom);
		setPanX(width / 2 - target.x * nextZoom);
		setPanY(height / 2 - target.y * nextZoom);
	});
</script>

<div class="canvas-shell">
	<canvas
		tabindex="0"
		aria-label={`${ariaLabel}. ${localeStore.t('canvas.instructions')}`}
		aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0"
		bind:this={canvas}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onpointerleave={clearTooltip}
		onwheel={onWheel}
		onkeydown={onCanvasKeyDown}
	></canvas>
	{#if tooltip}
		<div class="canvas-tooltip" style={`left:${tooltip.x + 12}px;top:${tooltip.y + 12}px`}>
			{tooltip.text}
		</div>
	{/if}
	{#if showHud}
		<div class="canvas-controls">
			<button title={localeStore.t('canvas.zoomOut')} onclick={() => zoomFromCenter(0.8)}>−</button>
			<button class="fit" title={localeStore.t('canvas.fit')} onclick={fitView}
				>{localeStore.t('canvas.fit')}</button
			>
			<button title={localeStore.t('canvas.zoomIn')} onclick={() => zoomFromCenter(1.25)}>+</button>
			<span>{zoom.toFixed(2)}x</span>
		</div>
	{/if}
</div>

<style>
	.canvas-shell {
		position: relative;
		min-height: 0;
		background: #d9dee8;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		touch-action: none;
	}

	canvas:active {
		cursor: move;
	}

	.canvas-controls {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: flex;
		align-items: center;
		gap: 2px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 8px;
		background: rgba(17, 24, 39, 0.82);
		color: #ffffff;
		font-size: 0.78rem;
		font-weight: 700;
		padding: 3px;
		backdrop-filter: blur(8px);
	}

	.canvas-controls button {
		border: 0;
		border-radius: 5px;
		background: rgba(255, 255, 255, 0.1);
		color: #ffffff;
		cursor: pointer;
		font: inherit;
		min-width: 28px;
		height: 26px;
	}

	.canvas-controls button:hover {
		background: rgba(255, 255, 255, 0.22);
	}

	.canvas-controls .fit {
		padding: 0 8px;
	}

	.canvas-controls span {
		min-width: 48px;
		padding: 0 5px;
		text-align: center;
	}

	.canvas-tooltip {
		position: absolute;
		z-index: 4;
		max-width: 280px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 5px;
		background: rgba(15, 23, 42, 0.94);
		color: #f8fafc;
		font-size: 0.75rem;
		font-weight: 700;
		padding: 5px 8px;
		pointer-events: none;
		white-space: nowrap;
	}
</style>
