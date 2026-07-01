<script lang="ts">
	import { onMount } from 'svelte';

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

	let {
		background = '#ffffff',
		draw,
		clipRect,
		syncZoom = $bindable(1),
		syncPanX = $bindable(0),
		syncPanY = $bindable(0),
		synced = false,
		showHud = true,
		onCanvasClick,
		resolveTooltip,
		focusKey,
		resolveFocus
	}: {
		background?: string;
		draw?: (context: DrawContext) => void;
		clipRect?: ClipRect;
		syncZoom?: number;
		syncPanX?: number;
		syncPanY?: number;
		synced?: boolean;
		showHud?: boolean;
		onCanvasClick?: (event: CanvasClick) => void;
		resolveTooltip?: (event: CanvasClick) => string | null;
		focusKey?: string | null;
		resolveFocus?: (width: number, height: number) => { x: number; y: number; zoom?: number } | null;
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

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const ratio = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		width = Math.max(1, Math.floor(rect.width));
		height = Math.max(1, Math.floor(rect.height));
		canvas.width = Math.floor(width * ratio);
		canvas.height = Math.floor(height * ratio);

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
	}

	function onPointerDown(event: PointerEvent) {
		isDragging = true;
		tooltip = null;
		lastX = event.clientX;
		lastY = event.clientY;
		downX = event.clientX;
		downY = event.clientY;
		canvas?.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!isDragging) {
			if (!canvas || !resolveTooltip) return;
			const rect = canvas.getBoundingClientRect();
			const point = {
				ctx: canvas.getContext('2d')!,
				width,
				height,
				zoom,
				panX,
				panY,
				x: event.clientX - rect.left,
				y: event.clientY - rect.top
			};
			const text = resolveTooltip(point);
			tooltip = text ? { x: point.x, y: point.y, text } : null;
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

	onMount(() => {
		const observer = new ResizeObserver(render);
		if (canvas) observer.observe(canvas);

		return () => observer.disconnect();
	});

	$effect(() => {
		zoom;
		panX;
		panY;
		draw;
		background;
		clipRect;
		render();
	});

	$effect(() => {
		if (synced || !focusKey || !resolveFocus || width <= 1 || height <= 1) return;
		const target = resolveFocus(width, height);
		if (!target) return;
		const nextZoom = Math.min(12, Math.max(1, target.zoom ?? 3));
		localZoom = nextZoom;
		localPanX = width / 2 - target.x * nextZoom;
		localPanY = height / 2 - target.y * nextZoom;
	});
</script>

<div class="canvas-shell">
	<canvas
		bind:this={canvas}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onpointerleave={() => (tooltip = null)}
		onwheel={onWheel}
	></canvas>
	{#if tooltip}
		<div class="canvas-tooltip" style={`left:${tooltip.x + 12}px;top:${tooltip.y + 12}px`}>
			{tooltip.text}
		</div>
	{/if}
	{#if showHud}
		<div class="hud">Zoom {zoom.toFixed(2)}x</div>
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

	.hud {
		position: absolute;
		right: 12px;
		bottom: 12px;
		border-radius: 6px;
		background: rgba(17, 24, 39, 0.82);
		color: #ffffff;
		font-size: 0.78rem;
		font-weight: 700;
		padding: 6px 8px;
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
