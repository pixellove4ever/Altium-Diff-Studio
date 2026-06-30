<script lang="ts">
	import BaseCanvas from '$lib/components/BaseCanvas.svelte';
	import {
		diffColors,
		getPadDiff,
		getPcbComponentDiff,
		getPolygonDiff,
		getTrackDiff,
		getViaDiff,
		type DiffStatus
	} from '$lib/diff/altiumDiff';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import type { AltiumPcbComponent, AltiumPcbDoc, AltiumPcbPad, AltiumPcbPolygon } from '$lib/types/altium';

	type Bounds = {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	};

	let visibleLayers = $state<Record<string, boolean>>({});

	const pcbA = $derived(projectStore.projectA.pcb);
	const pcbB = $derived(projectStore.projectB.pcb);
	const componentDiff = $derived(getPcbComponentDiff(pcbA, pcbB));
	const trackDiff = $derived(getTrackDiff(pcbA, pcbB));
	const padDiff = $derived(getPadDiff(pcbA, pcbB));
	const viaDiff = $derived(getViaDiff(pcbA, pcbB));
	const polygonDiff = $derived(getPolygonDiff(pcbA, pcbB));
	const changedComponents = $derived(componentDiff.filter((item) => item.status !== 'unchanged'));
	const changedTracks = $derived(trackDiff.filter((item) => item.status !== 'unchanged'));
	const changedPads = $derived(padDiff.filter((item) => item.status !== 'unchanged'));
	const changedVias = $derived(viaDiff.filter((item) => item.status !== 'unchanged'));
	const changedPolygons = $derived(polygonDiff.filter((item) => item.status !== 'unchanged'));
	let showComponents = $state(true);
	let showPlanes = $state(true);
	const layers = $derived.by(() => {
		const used = new Set<string>();
		const declaredOrder = new Map<string, number>();
		for (const pcb of [pcbA, pcbB]) {
			pcb?.layers.forEach((layer, index) => declaredOrder.set(layer, Math.min(declaredOrder.get(layer) ?? index, index)));
			pcb?.tracks.forEach((track) => used.add(track.layer));
			pcb?.arcs?.forEach((arc) => used.add(arc.layer));
			pcb?.pads.forEach((pad) => used.add(pad.layer));
			pcb?.polygons?.forEach((polygon) => used.add(polygon.layer));
			pcb?.texts?.forEach((text) => used.add(text.layer));
			pcb?.vias.forEach((via) => {
				used.add(via.startLayer);
				used.add(via.endLayer);
			});
		}
		return Array.from(used).sort((a, b) => {
			const orderA = declaredOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
			const orderB = declaredOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
			return orderA === orderB ? a.localeCompare(b) : orderA - orderB;
		});
	});

	$effect(() => {
		for (const layer of layers) {
			if (visibleLayers[layer] === undefined) visibleLayers[layer] = true;
		}
	});

	function include(bounds: Bounds, x: number, y: number) {
		bounds.minX = Math.min(bounds.minX, x);
		bounds.minY = Math.min(bounds.minY, y);
		bounds.maxX = Math.max(bounds.maxX, x);
		bounds.maxY = Math.max(bounds.maxY, y);
	}

	function getBounds(...pcbs: Array<AltiumPcbDoc | null>): Bounds {
		const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

		for (const pcb of pcbs) {
			if (!pcb) continue;
			for (const track of pcb.tracks) {
				include(bounds, track.start.x, track.start.y);
				include(bounds, track.end.x, track.end.y);
			}
			pcb.boardOutline?.forEach((point) => include(bounds, point.x, point.y));
			pcb.polygons?.forEach((polygon) => polygon.vertices.forEach((point) => include(bounds, point.x, point.y)));
			for (const pad of pcb.pads) include(bounds, pad.x, pad.y);
			for (const via of pcb.vias) include(bounds, via.x, via.y);
			for (const component of pcb.components) include(bounds, component.x, component.y);
		}

		if (!Number.isFinite(bounds.minX)) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
		return bounds;
	}

	function isLayerVisible(layer: string) {
		return visibleLayers[layer] !== false;
	}

	function layerIndex(layer: string) {
		const index = layers.indexOf(layer);
		return index === -1 ? Number.MAX_SAFE_INTEGER : index;
	}

	function isViaVisible(startLayer: string, endLayer: string) {
		const start = layerIndex(startLayer);
		const end = layerIndex(endLayer);
		const min = Math.min(start, end);
		const max = Math.max(start, end);
		return layers.some((layer, index) => index >= min && index <= max && isLayerVisible(layer));
	}

	function layerColor(layer: string, status: DiffStatus) {
		if (status !== 'unchanged') return pcbDiffColor(status);
		return '#6b7280';
	}

	function pcbDiffColor(status: DiffStatus) {
		if (status === 'removed') return '#16a34a'; // Only in A
		if (status === 'added') return '#dc2626'; // Only in B
		if (status === 'modified') return '#f97316';
		return '#6b7280';
	}

	function pcbAlpha(status: DiffStatus, kind: 'plane' | 'line' | 'component') {
		if (status !== 'unchanged') return kind === 'plane' ? 0.36 : 0.95;
		if (kind === 'plane') return 0.14;
		if (kind === 'component') return 0.42;
		return 0.34;
	}

	function drawPad(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shape: string) {
		if (shape === 'round') {
			ctx.beginPath();
			ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
			ctx.fill();
			return;
		}

		ctx.fillRect(x - w / 2, y - h / 2, w, h);
	}

	function drawComponentLabel(ctx: CanvasRenderingContext2D, component: AltiumPcbComponent, status: DiffStatus) {
		ctx.save();
		ctx.strokeStyle = pcbDiffColor(status);
		ctx.fillStyle = pcbDiffColor(status);
		ctx.translate(component.x, component.y);
		ctx.rotate((component.rotation * Math.PI) / 180);
		ctx.lineWidth = status === 'modified' ? 0.45 : 0.28;
		ctx.strokeRect(-2.4, -1.4, 4.8, 2.8);
		ctx.fillText(component.designator, 3.2, -2);
		ctx.restore();
	}

	function drawPadItem(ctx: CanvasRenderingContext2D, pad: AltiumPcbPad, status: DiffStatus) {
		if (!isLayerVisible(pad.layer)) return;
		ctx.fillStyle = pcbDiffColor(status);
		ctx.globalAlpha = pcbAlpha(status, 'line');
		drawPad(ctx, pad.x, pad.y, Math.max(pad.size.x, 0.5), Math.max(pad.size.y, 0.5), pad.shape);
		if (pad.holeSize > 0) {
			ctx.save();
			ctx.globalCompositeOperation = 'destination-out';
			ctx.beginPath();
			ctx.arc(pad.x, pad.y, pad.holeSize / 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}
		ctx.globalAlpha = 1;
	}

	function drawPolygon(ctx: CanvasRenderingContext2D, polygon: AltiumPcbPolygon, status: DiffStatus) {
		if (!showPlanes || !isLayerVisible(polygon.layer) || polygon.vertices.length < 3) return;

		ctx.save();
		ctx.fillStyle = pcbDiffColor(status);
		ctx.strokeStyle = pcbDiffColor(status);
		ctx.globalAlpha = pcbAlpha(status, 'plane');
		ctx.beginPath();
		ctx.moveTo(polygon.vertices[0].x, polygon.vertices[0].y);
		for (const point of polygon.vertices.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.closePath();
		ctx.fill();
		ctx.globalAlpha = Math.min(0.75, pcbAlpha(status, 'line'));
		ctx.lineWidth = 0.12;
		ctx.stroke();
		ctx.restore();
	}

	function drawBoardOutline(ctx: CanvasRenderingContext2D) {
		const outline = pcbB?.boardOutline?.length ? pcbB.boardOutline : pcbA?.boardOutline;
		if (!outline || outline.length < 2) return;

		ctx.save();
		ctx.strokeStyle = '#e5e7eb';
		ctx.globalAlpha = 0.72;
		ctx.lineWidth = 0.18;
		ctx.beginPath();
		ctx.moveTo(outline[0].x, outline[0].y);
		for (const point of outline.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.closePath();
		ctx.stroke();
		ctx.restore();
	}

	function drawDiff(ctx: CanvasRenderingContext2D, selected: string | null) {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.font = '2.8px Inter, system-ui, sans-serif';

		const activeTracks = trackDiff
			.filter(({ item }) => isLayerVisible(item.layer))
			.sort((a, b) => layerIndex(a.item.layer) - layerIndex(b.item.layer));
		const activePads = padDiff
			.filter(({ item }) => isLayerVisible(item.layer))
			.sort((a, b) => layerIndex(a.item.layer) - layerIndex(b.item.layer));

		if (showPlanes) {
			for (const { item: polygon, status } of polygonDiff) {
				drawPolygon(ctx, polygon, status);
			}
		}

		for (const { item: track, status } of activeTracks) {
			if (!isLayerVisible(track.layer)) continue;
			ctx.strokeStyle = layerColor(track.layer, status);
			ctx.globalAlpha = pcbAlpha(status, 'line');
			ctx.lineWidth = Math.max(track.width, 0.12);
			ctx.beginPath();
			ctx.moveTo(track.start.x, track.start.y);
			ctx.lineTo(track.end.x, track.end.y);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		for (const { item: pad, status } of activePads) {
			drawPadItem(ctx, pad, status);
		}

		for (const { item: via, status } of viaDiff) {
			if (!isViaVisible(via.startLayer, via.endLayer)) continue;
			ctx.fillStyle = pcbDiffColor(status);
			ctx.strokeStyle = '#f8fafc';
			ctx.globalAlpha = pcbAlpha(status, 'line');
			ctx.lineWidth = 0.12;
			ctx.beginPath();
			ctx.arc(via.x, via.y, Math.max(via.diameter / 2, 0.25), 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		if (showComponents) {
			for (const diff of componentDiff) {
				const component = diff.after ?? diff.before;
				if (!component) continue;
				if (!isLayerVisible(component.layer)) continue;
				ctx.globalAlpha = pcbAlpha(diff.status, 'component');
				drawComponentLabel(ctx, component, diff.status);
			}
			ctx.globalAlpha = 1;
		}

		drawBoardOutline(ctx);

		if (showComponents && selected) {
			const component = componentDiff
				.find((item) => item.designator.toLowerCase() === selected.toLowerCase())
				?.after;
			if (component) {
				ctx.save();
				ctx.strokeStyle = '#facc15';
				ctx.lineWidth = 0.45;
				ctx.beginPath();
				ctx.arc(component.x, component.y, 4, 0, Math.PI * 2);
				ctx.stroke();
				ctx.restore();
			}
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
		const bounds = getBounds(pcbA, pcbB);
		const dataWidth = Math.max(bounds.maxX - bounds.minX, 1);
		const dataHeight = Math.max(bounds.maxY - bounds.minY, 1);
		const fit = Math.min((width - 64) / dataWidth, (height - 64) / dataHeight);

		ctx.save();
		ctx.translate(width / 2, height / 2);
		ctx.scale(fit, -fit);
		ctx.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2);

		drawDiff(ctx, projectStore.selectedDesignator);
		ctx.restore();
	}
</script>

<div class="pcb-view">
	<div class="layer-panel">
		<h3>Layers</h3>
		<div class="legend">
			<span><i class="only-a"></i>Only A</span>
			<span><i class="only-b"></i>Only B</span>
			<span><i class="common"></i>Common</span>
			<span><i class="modified"></i>Modified</span>
		</div>
		<label class="toggle">
			<input type="checkbox" bind:checked={showComponents} />
			<span>Show components</span>
		</label>
		<label class="toggle">
			<input type="checkbox" bind:checked={showPlanes} />
			<span>Show copper planes</span>
		</label>
		{#each layers as layer}
			<label>
				<input type="checkbox" bind:checked={visibleLayers[layer]} />
				<span><i style={`background: ${layerColor(layer, 'unchanged')}`}></i>{layer}</span>
			</label>
		{/each}
		<div class="route-diff">
			<h3>Routing diff</h3>
			<div class="route-counts">
				<span>{changedTracks.length} tracks</span>
				<span>{changedPads.length} pads</span>
				<span>{changedVias.length} vias</span>
				<span>{changedPolygons.length} planes</span>
				<span>{changedComponents.length} components</span>
			</div>
			{#each changedComponents as diff}
				<button
					style={`--status-color: ${pcbDiffColor(diff.status)}`}
					class:selected={projectStore.selectedDesignator === diff.designator}
					onclick={() => projectStore.selectDesignator(diff.designator)}
				>
					<strong>{diff.designator}</strong>
					<span>{diff.status}</span>
				</button>
			{/each}
		</div>
	</div>
	<BaseCanvas background="#111827" {draw} />
</div>

<style>
	.pcb-view {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		min-height: 0;
	}

	.layer-panel {
		border-right: 1px solid #d5dbe5;
		background: #ffffff;
		padding: 14px;
		overflow: auto;
	}

	h3 {
		margin: 0 0 12px;
		font-size: 0.88rem;
		text-transform: uppercase;
		color: #526070;
	}

	label {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 30px;
		color: #344054;
		font-size: 0.86rem;
	}

	.toggle {
		border-bottom: 1px solid #e5e7eb;
		margin-bottom: 10px;
		padding-bottom: 10px;
		font-weight: 700;
	}

	label span {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	label i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}

	.legend {
		display: flex;
		flex-direction: column;
		gap: 6px;
		border-bottom: 1px solid #e5e7eb;
		margin-bottom: 10px;
		padding-bottom: 10px;
		color: #526070;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.legend span {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.legend .only-a {
		background: #16a34a;
	}

	.legend .only-b {
		background: #dc2626;
	}

	.legend .common {
		background: #6b7280;
		opacity: 0.55;
	}

	.legend .modified {
		background: #f97316;
	}

	.route-diff {
		border-top: 1px solid #e5e7eb;
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
		padding-top: 12px;
	}

	.route-counts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		color: #526070;
		font-size: 0.78rem;
	}

	.route-counts span {
		border: 1px solid #e5e7eb;
		border-radius: 5px;
		padding: 5px 6px;
	}

	.route-diff button {
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

	.route-diff button.selected {
		background: #fffbeb;
	}

	.route-diff button span {
		color: var(--status-color);
		font-weight: 800;
		text-transform: uppercase;
	}
</style>
