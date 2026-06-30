<script lang="ts">
	import BaseCanvas from '$lib/components/BaseCanvas.svelte';
	import {
		diffColors,
		getNetLabelDiff,
		getSchematicComponentDiff,
		getWireDiff,
		type DiffStatus
	} from '$lib/diff/altiumDiff';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import type {
		AltiumSchComponent,
		AltiumSchNetLabel,
		AltiumSchSheet,
		AltiumSchWire,
		AltiumSchematicDoc
	} from '$lib/types/altium';

	type Bounds = {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	};

	const schematicA = $derived(projectStore.projectA.schematic);
	const schematicB = $derived(projectStore.projectB.schematic);
	let selectedSheetIndex = $state(0);
	const sheetOptions = $derived.by(() => {
		const maxLength = Math.max(schematicA?.sheets.length ?? 0, schematicB?.sheets.length ?? 0);
		return Array.from({ length: maxLength }, (_, index) => {
			const sheetA = schematicA?.sheets[index];
			const sheetB = schematicB?.sheets[index];
			return {
				index,
				label: sheetA?.name || sheetA?.fileName || sheetB?.name || sheetB?.fileName || `Sheet ${index + 1}`
			};
		});
	});
	const selectedA = $derived(sliceSchematic(schematicA, selectedSheetIndex));
	const selectedB = $derived(sliceSchematic(schematicB, selectedSheetIndex));
	const componentDiff = $derived(getSchematicComponentDiff(selectedA, selectedB));
	const wireDiff = $derived(getWireDiff(selectedA, selectedB));
	const netLabelDiff = $derived(getNetLabelDiff(selectedA, selectedB));
	const visibleComponentDiff = $derived(componentDiff.filter((item) => item.status !== 'unchanged'));
	const visibleWireDiff = $derived(wireDiff.filter((item) => item.status !== 'unchanged'));
	const visibleNetLabelDiff = $derived(netLabelDiff.filter((item) => item.status !== 'unchanged'));

	$effect(() => {
		if (selectedSheetIndex >= sheetOptions.length) selectedSheetIndex = Math.max(0, sheetOptions.length - 1);
	});

	function sliceSchematic(doc: AltiumSchematicDoc | null, index: number): AltiumSchematicDoc | null {
		const sheet = doc?.sheets[index];
		if (!doc || !sheet) return null;
		return { ...doc, sheets: [sheet] };
	}

	function include(bounds: Bounds, x: number, y: number) {
		bounds.minX = Math.min(bounds.minX, x);
		bounds.minY = Math.min(bounds.minY, y);
		bounds.maxX = Math.max(bounds.maxX, x);
		bounds.maxY = Math.max(bounds.maxY, y);
	}

	function getSheets(doc: AltiumSchematicDoc | null): AltiumSchSheet[] {
		return doc?.sheets ?? [];
	}

	function getBounds(...docs: Array<AltiumSchematicDoc | null>): Bounds {
		const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

		for (const doc of docs) {
			for (const sheet of getSheets(doc)) {
				for (const wire of sheet.wires) {
					const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
					points.forEach((point) => include(bounds, point.x, point.y));
				}
				for (const label of sheet.netLabels) include(bounds, label.x, label.y);
				for (const component of sheet.components) {
					include(bounds, component.x, component.y);
					component.pins?.forEach((pin) => include(bounds, pin.x, pin.y));
				}
			}
		}

		if (!Number.isFinite(bounds.minX)) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
		return bounds;
	}

	function drawReadableText(
		ctx: CanvasRenderingContext2D,
		text: string,
		x: number,
		y: number,
		worldPerPx: number,
		size = 11,
		align: CanvasTextAlign = 'left'
	) {
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(1, -1);
		ctx.textAlign = align;
		ctx.textBaseline = 'middle';
		ctx.font = `${size * worldPerPx}px Inter, system-ui, sans-serif`;
		ctx.fillText(text, 0, 0);
		ctx.restore();
	}

	function getComponentBody(component: AltiumSchComponent, worldPerPx: number) {
		const pins = component.pins ?? [];
		if (pins.length === 0) {
			const width = 86 * worldPerPx;
			const height = 42 * worldPerPx;
			return {
				left: component.x - width / 2,
				right: component.x + width / 2,
				top: component.y - height / 2,
				bottom: component.y + height / 2
			};
		}

		const xs = pins.map((pin) => pin.x);
		const ys = pins.map((pin) => pin.y);
		const pad = 18 * worldPerPx;
		const minWidth = 90 * worldPerPx;
		const minHeight = 46 * worldPerPx;
		const pinLeft = Math.min(...xs);
		const pinRight = Math.max(...xs);
		const pinTop = Math.min(...ys);
		const pinBottom = Math.max(...ys);
		const centerX = (pinLeft + pinRight + component.x) / 3;
		const centerY = (pinTop + pinBottom + component.y) / 3;
		const width = Math.max(pinRight - pinLeft + pad * 2, minWidth);
		const height = Math.max(pinBottom - pinTop + pad * 2, minHeight);

		return {
			left: centerX - width / 2,
			right: centerX + width / 2,
			top: centerY - height / 2,
			bottom: centerY + height / 2
		};
	}

	function clamp(value: number, min: number, max: number) {
		return Math.max(min, Math.min(max, value));
	}

	function drawComponent(
		ctx: CanvasRenderingContext2D,
		component: AltiumSchComponent,
		status: DiffStatus,
		selected: string | null,
		worldPerPx: number
	) {
		const isSelected = selected?.toLowerCase() === component.designator.toLowerCase();
		const body = getComponentBody(component, worldPerPx);
		const width = body.right - body.left;
		const height = body.bottom - body.top;

		ctx.save();
		ctx.strokeStyle = isSelected ? '#facc15' : diffColors[status];
		ctx.fillStyle = status === 'unchanged' ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.94)';
		ctx.lineWidth = (isSelected ? 2.6 : 1.6) * worldPerPx;
		ctx.fillRect(body.left, body.top, width, height);
		ctx.strokeRect(body.left, body.top, width, height);

		ctx.fillStyle = diffColors[status];
		drawReadableText(ctx, component.designator, body.left + 7 * worldPerPx, body.top + 14 * worldPerPx, worldPerPx, 12);
		drawReadableText(
			ctx,
			component.comment || component.libRef,
			body.left + 7 * worldPerPx,
			body.top + 29 * worldPerPx,
			worldPerPx,
			10
		);

		for (const pin of component.pins ?? []) {
			const edgeX = clamp(pin.x, body.left, body.right);
			const edgeY = clamp(pin.y, body.top, body.bottom);
			ctx.strokeStyle = diffColors[status];
			ctx.lineWidth = 1.1 * worldPerPx;
			ctx.beginPath();
			ctx.moveTo(pin.x, pin.y);
			ctx.lineTo(edgeX, edgeY);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(pin.x, pin.y, 2.2 * worldPerPx, 0, Math.PI * 2);
			ctx.fill();
			drawReadableText(ctx, pin.num || pin.name, pin.x + 5 * worldPerPx, pin.y, worldPerPx, 8);
		}
		ctx.restore();
	}

	function drawWire(ctx: CanvasRenderingContext2D, wire: AltiumSchWire, status: DiffStatus, worldPerPx: number) {
		const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
		if (points.length < 2) return;

		ctx.strokeStyle = diffColors[status];
		ctx.lineWidth = (status === 'unchanged' ? 1.2 : 2.2) * worldPerPx;
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.stroke();
	}

	function drawNetLabel(
		ctx: CanvasRenderingContext2D,
		label: AltiumSchNetLabel,
		status: DiffStatus,
		worldPerPx: number
	) {
		ctx.fillStyle = diffColors[status];
		drawReadableText(ctx, label.text, label.x, label.y, worldPerPx, 12);
	}

	function drawDiff(ctx: CanvasRenderingContext2D, selected: string | null, worldPerPx: number) {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		for (const { item, status } of wireDiff) {
			drawWire(ctx, item, status, worldPerPx);
		}

		for (const { item, status } of netLabelDiff) {
			drawNetLabel(ctx, item, status, worldPerPx);
		}

		for (const diff of componentDiff) {
			const component = diff.after ?? diff.before;
			if (!component) continue;
			drawComponent(ctx, component, diff.status, selected, worldPerPx);
		}
	}

	function draw({
		ctx,
		width,
		height
	}: {
		ctx: CanvasRenderingContext2D;
		width: number;
		height: number;
	}) {
		const bounds = getBounds(selectedA, selectedB);
		const dataWidth = Math.max(bounds.maxX - bounds.minX, 1);
		const dataHeight = Math.max(bounds.maxY - bounds.minY, 1);
		const fit = Math.max(0.000001, Math.min((width - 96) / dataWidth, (height - 96) / dataHeight));
		const worldPerPx = 1 / fit;

		ctx.save();
		ctx.translate(width / 2, height / 2);
		ctx.scale(fit, -fit);
		ctx.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2);

		drawDiff(ctx, projectStore.selectedDesignator, worldPerPx);
		ctx.restore();
	}
</script>

<div class="schematic-view">
	<aside class="diff-panel">
		<div class="page-control">
			<label>
				Page
				<select bind:value={selectedSheetIndex}>
					{#each sheetOptions as sheet}
						<option value={sheet.index}>{sheet.label}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="legend">
			<span><i class="added"></i>Added</span>
			<span><i class="removed"></i>Removed</span>
			<span><i class="modified"></i>Modified</span>
		</div>
		<div class="sheet-stats">
			<span>A: {selectedA?.sheets[0]?.components.length ?? 0} comp, {selectedA?.sheets[0]?.wires.length ?? 0} wires</span>
			<span>B: {selectedB?.sheets[0]?.components.length ?? 0} comp, {selectedB?.sheets[0]?.wires.length ?? 0} wires</span>
		</div>
		<div class="change-list">
			<h3>Differences</h3>
			{#each visibleComponentDiff as diff}
				<button
					class:selected={projectStore.selectedDesignator === diff.designator}
					style={`--status-color: ${diffColors[diff.status]}`}
					onclick={() => projectStore.selectDesignator(diff.designator)}
				>
					<strong>{diff.designator}</strong>
					<span>{diff.status}</span>
				</button>
			{/each}
			{#if visibleWireDiff.length > 0 || visibleNetLabelDiff.length > 0}
				<p>{visibleWireDiff.length} wire changes, {visibleNetLabelDiff.length} label changes</p>
			{/if}
			{#if visibleComponentDiff.length === 0 && visibleWireDiff.length === 0 && visibleNetLabelDiff.length === 0}
				<p>No schematic difference on this page.</p>
			{/if}
		</div>
	</aside>
	<div class="canvas-area">
		<BaseCanvas background="#fbfcff" {draw} />
	</div>
</div>

<style>
	.schematic-view {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: 280px minmax(0, 1fr);
		min-height: 0;
	}

	.diff-panel {
		border-right: 1px solid #d5dbe5;
		background: #ffffff;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: auto;
	}

	.canvas-area {
		min-width: 0;
		min-height: 0;
	}

	label {
		display: grid;
		gap: 7px;
		color: #526070;
		font-size: 0.78rem;
		font-weight: 800;
	}

	select {
		border: 1px solid #d0d5dd;
		border-radius: 5px;
		background: #ffffff;
		color: #111827;
		font: inherit;
		min-height: 28px;
		width: 100%;
		padding: 0 8px;
	}

	.legend {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-bottom: 1px solid #e5e7eb;
		padding-bottom: 12px;
		color: #526070;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.legend span {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.legend .added {
		background: #16a34a;
	}

	.legend .removed {
		background: #dc2626;
	}

	.legend .modified {
		background: #f97316;
	}

	.sheet-stats {
		display: flex;
		flex-direction: column;
		gap: 5px;
		border-radius: 6px;
		background: rgba(17, 24, 39, 0.82);
		color: #ffffff;
		font-size: 0.78rem;
		font-weight: 700;
		padding: 7px 9px;
	}

	.change-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	h3 {
		margin: 0 0 2px;
		color: #526070;
		font-size: 0.78rem;
		text-transform: uppercase;
	}

	.change-list button {
		border-left: 4px solid var(--status-color);
		border-radius: 6px;
		background: #f8fafc;
		color: #111827;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 10px;
		text-align: left;
	}

	.change-list button.selected {
		background: #fffbeb;
	}

	.change-list span {
		color: var(--status-color);
		font-weight: 800;
		text-transform: uppercase;
	}

	.change-list p {
		margin: 0;
		color: #667085;
		font-size: 0.83rem;
	}
</style>
