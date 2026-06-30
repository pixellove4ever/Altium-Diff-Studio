<script lang="ts">
	import { onMount } from 'svelte';

	type DrawContext = {
		ctx: CanvasRenderingContext2D;
		width: number;
		height: number;
		zoom: number;
		panX: number;
		panY: number;
	};

	let {
		background = '#ffffff',
		draw
	}: {
		background?: string;
		draw?: (context: DrawContext) => void;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let lastX = $state(0);
	let lastY = $state(0);
	let width = $state(1);
	let height = $state(1);

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
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);
		draw?.({ ctx, width, height, zoom, panX, panY });
		ctx.restore();
	}

	function onPointerDown(event: PointerEvent) {
		isDragging = true;
		lastX = event.clientX;
		lastY = event.clientY;
		canvas?.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!isDragging) return;

		panX += event.clientX - lastX;
		panY += event.clientY - lastY;
		lastX = event.clientX;
		lastY = event.clientY;
	}

	function onPointerUp(event: PointerEvent) {
		isDragging = false;
		canvas?.releasePointerCapture(event.pointerId);
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

		zoom = nextZoom;
		panX = mouseX - worldX * nextZoom;
		panY = mouseY - worldY * nextZoom;
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
		render();
	});
</script>

<div class="canvas-shell">
	<canvas
		bind:this={canvas}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onwheel={onWheel}
	></canvas>
	<div class="hud">Zoom {zoom.toFixed(2)}x</div>
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
		cursor: grab;
		touch-action: none;
	}

	canvas:active {
		cursor: grabbing;
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
</style>
