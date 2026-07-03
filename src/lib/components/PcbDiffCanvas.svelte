<script lang="ts">
	import BaseCanvas, {
		type CanvasClick,
		type CanvasPerformanceMetric
	} from '$lib/components/BaseCanvas.svelte';
	import { diffColors, getPcbDiffBundle, type DiffStatus } from '$lib/diff/altiumDiff';
	import { getPcbSpatialIndex } from '$lib/domain/pcbSpatialIndex';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import type { AltiumPcbDoc } from '$lib/types/altium';
	import {
		drawArc,
		drawBoardOutlineEdges,
		drawComponentLabel,
		drawPad,
		drawPcbText,
		drawPolygon,
		drawSelectedArc,
		drawSelectedHighlight,
		drawSelectedPad,
		drawSelectedTrack,
		drawSelectedVia,
		drawSoloPcb,
		drawTrack,
		drawVia,
		getPcbBounds,
		layerColor,
		pcbAlpha,
		pcbDiffColor,
		selectedLayerColor,
		soloLayerColor,
		type Bounds
	} from './pcbRenderer';

	type ViewMode = 'diff' | 'side-by-side' | 'overlay';

	let visibleLayers = $state<Record<string, boolean>>({});
	let layerOpacities = $state<Record<string, number>>({});

	const pcbA = $derived(projectStore.projectA.pcb);
	const pcbB = $derived(
		projectStore.mode === 'view' ? projectStore.projectA.pcb : projectStore.projectB.pcb
	);
	const pcbDiff = $derived(getPcbDiffBundle(pcbA, pcbB));
	const componentDiff = $derived(pcbDiff.components);
	const trackDiff = $derived(pcbDiff.tracks);
	const padDiff = $derived(pcbDiff.pads);
	const viaDiff = $derived(pcbDiff.vias);
	const polygonDiff = $derived(pcbDiff.polygons);
	const arcDiff = $derived(pcbDiff.arcs);
	const textDiff = $derived(pcbDiff.texts);
	const pcbBounds = $derived(getPcbBounds(pcbA, pcbB));
	const activeIndex = $derived(
		projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB
	);
	const selectedNetDetails = $derived(
		projectStore.selectedNet
			? (activeIndex.byNet.get(projectStore.selectedNet.toUpperCase()) ?? null)
			: null
	);
	const selectedNetComponents = $derived(
		(selectedNetDetails?.components ?? [])
			.map((designator) => activeIndex.byDesignator.get(designator.toUpperCase()))
			.filter((component) => component !== undefined)
	);
	const changedComponents = $derived(componentDiff.filter((item) => item.status !== 'unchanged'));
	const changedTracks = $derived(trackDiff.filter((item) => item.status !== 'unchanged'));
	const changedPads = $derived(padDiff.filter((item) => item.status !== 'unchanged'));
	const changedVias = $derived(viaDiff.filter((item) => item.status !== 'unchanged'));
	const changedPolygons = $derived(polygonDiff.filter((item) => item.status !== 'unchanged'));
	const changedArcs = $derived(arcDiff.filter((item) => item.status !== 'unchanged'));
	const changedTexts = $derived(textDiff.filter((item) => item.status !== 'unchanged'));
	let showComponents = $state(false);
	let showDesignators = $state(false);
	let showPlanes = $state(true);
	let showTexts = $state(false);
	let showVias = $state(false);
	let showPin1Markers = $state(false);
	let mirrored = $state(false);
	let profilingEnabled = $state(false);
	let performanceProfile = $state({
		render: { samples: 0, averageMs: 0, maximumMs: 0, lastMs: 0 },
		hitTest: { samples: 0, averageMs: 0, maximumMs: 0, lastMs: 0 }
	});
	const emptyMetricAccumulator = () => ({ totalMs: 0, maximumMs: 0, samples: 0, lastMs: 0 });
	let renderAccumulator = emptyMetricAccumulator();
	let hitTestAccumulator = emptyMetricAccumulator();
	let profileLastUpdate = 0;
	let viewMode = $state<ViewMode>('diff');

	// Synced zoom/pan for side-by-side mode
	let syncZoom = $state(1);
	let syncPanX = $state(0);
	let syncPanY = $state(0);

	// Overlay slider position (0-1, where 0.5 = center)
	let sliderPosition = $state(0.5);
	let isSliderDragging = $state(false);

	const layers = $derived.by(() => {
		const used = new Set<string>();
		const declaredOrder = new Map<string, number>();
		const addUsed = (layer: string | undefined) => {
			const normalized = layer?.trim();
			if (normalized) used.add(normalized);
		};
		for (const pcb of [pcbA, pcbB]) {
			pcb?.layers.forEach((layer, index) =>
				declaredOrder.set(layer, Math.min(declaredOrder.get(layer) ?? index, index))
			);
			pcb?.tracks.forEach((track) => addUsed(track.layer));
			pcb?.arcs?.forEach((arc) => addUsed(arc.layer));
			pcb?.pads.forEach((pad) => addUsed(pad.layer));
			pcb?.polygons?.forEach((polygon) => addUsed(polygon.layer));
			pcb?.texts?.forEach((text) => addUsed(text.layer));
			pcb?.components.forEach((component) => addUsed(component.layer));
			pcb?.vias.forEach((via) => {
				addUsed(via.startLayer);
				addUsed(via.endLayer);
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
			if (layerOpacities[layer] === undefined) layerOpacities[layer] = 1;
		}
	});

	const layerOrder = $derived(new Map(layers.map((layer, index) => [layer, index])));
	const activeTracks = $derived.by(() =>
		trackDiff
			.filter(({ item }) => visibleLayers[item.layer] !== false)
			.sort(
				(a, b) =>
					(layerOrder.get(a.item.layer) ?? Number.MAX_SAFE_INTEGER) -
					(layerOrder.get(b.item.layer) ?? Number.MAX_SAFE_INTEGER)
			)
	);
	const activePads = $derived.by(() =>
		padDiff
			.filter(({ item }) => visibleLayers[item.layer] !== false)
			.sort(
				(a, b) =>
					(layerOrder.get(a.item.layer) ?? Number.MAX_SAFE_INTEGER) -
					(layerOrder.get(b.item.layer) ?? Number.MAX_SAFE_INTEGER)
			)
	);

	$effect(() => {
		const selected = projectStore.selectedDesignator?.toUpperCase();
		if (!selected) return;
		const component =
			pcbB?.components.find((candidate) => candidate.designator.toUpperCase() === selected) ??
			pcbA?.components.find((candidate) => candidate.designator.toUpperCase() === selected);
		if (!component || visibleLayers[component.layer] !== false) return;
		visibleLayers = { ...visibleLayers, [component.layer]: true };
	});

	function isLayerVisible(layer: string) {
		return visibleLayers[layer] !== false;
	}

	function layerOpacity(layer: string) {
		return Math.max(0.05, Math.min(1, layerOpacities[layer] ?? 1));
	}

	function layerIndex(layer: string) {
		return layerOrder.get(layer) ?? Number.MAX_SAFE_INTEGER;
	}

	function isViaVisible(startLayer: string, endLayer: string) {
		const start = layerIndex(startLayer);
		const end = layerIndex(endLayer);
		const min = Math.min(start, end);
		const max = Math.max(start, end);
		return layers.some((layer, index) => index >= min && index <= max && isLayerVisible(layer));
	}

	function setAllLayers(visible: boolean) {
		visibleLayers = Object.fromEntries(layers.map((layer) => [layer, visible]));
	}

	function resetPerformanceProfile() {
		renderAccumulator = emptyMetricAccumulator();
		hitTestAccumulator = emptyMetricAccumulator();
		profileLastUpdate = 0;
		performanceProfile = {
			render: { samples: 0, averageMs: 0, maximumMs: 0, lastMs: 0 },
			hitTest: { samples: 0, averageMs: 0, maximumMs: 0, lastMs: 0 }
		};
	}

	function toggleProfiling() {
		profilingEnabled = !profilingEnabled;
		resetPerformanceProfile();
	}

	function recordPerformanceMetric(metric: CanvasPerformanceMetric) {
		if (!profilingEnabled) return;
		const accumulator = metric.kind === 'render' ? renderAccumulator : hitTestAccumulator;
		accumulator.samples += 1;
		accumulator.totalMs += metric.durationMs;
		accumulator.maximumMs = Math.max(accumulator.maximumMs, metric.durationMs);
		accumulator.lastMs = metric.durationMs;
		const now = performance.now();
		if (now - profileLastUpdate < 250 && accumulator.samples > 1) return;
		profileLastUpdate = now;
		performanceProfile = {
			render: {
				samples: renderAccumulator.samples,
				averageMs: renderAccumulator.samples
					? renderAccumulator.totalMs / renderAccumulator.samples
					: 0,
				maximumMs: renderAccumulator.maximumMs,
				lastMs: renderAccumulator.lastMs
			},
			hitTest: {
				samples: hitTestAccumulator.samples,
				averageMs: hitTestAccumulator.samples
					? hitTestAccumulator.totalMs / hitTestAccumulator.samples
					: 0,
				maximumMs: hitTestAccumulator.maximumMs,
				lastMs: hitTestAccumulator.lastMs
			}
		};
	}

	// ---- Diff mode draw ----

	function drawDiff(ctx: CanvasRenderingContext2D, selected: string | null) {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.font = '2.8px Inter, system-ui, sans-serif';

		if (showPlanes) {
			for (const { item: polygon, status } of polygonDiff) {
				if (!isLayerVisible(polygon.layer)) continue;
				const changed = status !== 'unchanged';
				const color = changed ? pcbDiffColor(status) : '#64748b';
				const opacity = layerOpacity(polygon.layer);
				drawPolygon(
					ctx,
					polygon,
					color,
					(changed ? 0.13 : 0.07) * opacity,
					(changed ? 0.86 : 0.2) * opacity
				);
			}
		}

		for (const { item: track, status } of activeTracks) {
			drawTrack(
				ctx,
				track,
				layerColor(track.layer, status),
				pcbAlpha(status, 'line') * layerOpacity(track.layer)
			);
		}

		// Arcs
		for (const { item: arc, status } of arcDiff) {
			if (!isLayerVisible(arc.layer)) continue;
			drawArc(
				ctx,
				arc,
				layerColor(arc.layer, status),
				pcbAlpha(status, 'line') * layerOpacity(arc.layer)
			);
		}

		ctx.globalAlpha = 1;

		for (const { item: pad, status } of activePads) {
			drawPad(
				ctx,
				pad,
				pcbDiffColor(status),
				pcbAlpha(status, 'line') * layerOpacity(pad.layer),
				showPin1Markers
			);
		}

		if (showVias) {
			for (const { item: via, status } of viaDiff) {
				if (!isViaVisible(via.startLayer, via.endLayer)) continue;
				drawVia(
					ctx,
					via,
					pcbDiffColor(status),
					pcbAlpha(status, 'line') * layerOpacity(via.startLayer)
				);
			}
		}
		ctx.globalAlpha = 1;

		if (showComponents || showDesignators) {
			for (const diff of componentDiff) {
				const component = diff.after ?? diff.before;
				if (!component) continue;
				if (!isLayerVisible(component.layer)) continue;
				ctx.globalAlpha = pcbAlpha(diff.status, 'component') * layerOpacity(component.layer);
				drawComponentLabel(
					ctx,
					component,
					pcbDiffColor(diff.status),
					diff.status === 'modified' ? 0.45 : 0.28,
					showComponents,
					showDesignators
				);
			}
			ctx.globalAlpha = 1;
		}

		// Texts
		if (showTexts) {
			for (const { item: text, status } of textDiff) {
				if (!isLayerVisible(text.layer)) continue;
				const textPcb = pcbB ?? pcbA;
				const isDesignator =
					text.role === 'designator' ||
					(!text.role &&
						(textPcb?.components.some(
							(component) => component.designator.toUpperCase() === text.text.trim().toUpperCase()
						) ??
							false));
				if (isDesignator && !showDesignators) continue;
				drawPcbText(
					ctx,
					text,
					pcbDiffColor(status),
					pcbAlpha(status, 'line') * layerOpacity(text.layer)
				);
			}
		}

		drawBoardOutlineEdges(ctx, pcbB ?? pcbA);

		const selectedNet = projectStore.selectedNet?.toUpperCase();
		if (selectedNet) {
			const pcb = pcbB ?? pcbA;
			if (pcb) {
				for (const polygon of pcb.polygons ?? []) {
					if (polygon.net?.toUpperCase() === selectedNet)
						drawPolygon(ctx, polygon, selectedLayerColor(polygon.layer, layers), 0.38, 1);
				}
				for (const track of pcb.tracks) {
					if (track.net?.toUpperCase() === selectedNet)
						drawSelectedTrack(ctx, track, selectedLayerColor(track.layer, layers));
				}
				for (const arc of pcb.arcs ?? []) {
					if (arc.net?.toUpperCase() === selectedNet)
						drawSelectedArc(ctx, arc, selectedLayerColor(arc.layer, layers));
				}
				for (const via of pcb.vias) {
					if (via.net?.toUpperCase() === selectedNet)
						drawSelectedVia(ctx, via, selectedLayerColor(via.startLayer, layers));
				}
				for (const pad of pcb.pads) {
					if (pad.net?.toUpperCase() === selectedNet)
						drawSelectedPad(ctx, pad, selectedLayerColor(pad.layer, layers), showPin1Markers);
				}
			}
		}

		if (selected) {
			const selectedDiff = componentDiff.find(
				(item) => item.designator.toLowerCase() === selected.toLowerCase()
			);
			const component = selectedDiff?.after ?? selectedDiff?.before;
			if (component) {
				const radius = component.bounds
					? Math.max(
							4,
							Math.hypot(
								component.bounds.x2 - component.bounds.x1,
								component.bounds.y2 - component.bounds.y1
							) /
								2 +
								1
						)
					: 4;
				drawSelectedHighlight(
					ctx,
					component.x,
					component.y,
					radius,
					selectedLayerColor(component.layer, layers)
				);
			}
		}
	}

	function distanceToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number) {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lengthSquared = dx * dx + dy * dy;
		if (lengthSquared === 0) return Math.hypot(x - x1, y - y1);
		const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
		return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
	}

	function onPcbClick(event: CanvasClick) {
		const pcb = pcbB ?? pcbA;
		if (!pcb) return;
		const { x, y, tolerance } = canvasToWorld(event);
		const pad = hitPad(pcb, x, y, tolerance);
		if (pad?.net) {
			projectStore.selectNet(pad.net);
			return;
		}
		if (pad?.component) {
			projectStore.selectDesignator(pad.component);
			return;
		}
		const track = hitTrack(pcb, x, y, tolerance);
		if (track?.net) {
			projectStore.selectNet(track.net);
			return;
		}
		const component = hitComponent(pcb, x, y, tolerance);
		projectStore.selectDesignator(component?.designator ?? null);
	}

	function canvasToWorld(event: CanvasClick) {
		const bounds = pcbBounds;
		const dataWidth = Math.max(bounds.maxX - bounds.minX, 1);
		const dataHeight = Math.max(bounds.maxY - bounds.minY, 1);
		const fit = Math.min((event.width - 64) / dataWidth, (event.height - 64) / dataHeight);
		const localX = (event.x - event.panX) / event.zoom;
		const localY = (event.y - event.panY) / event.zoom;
		return {
			x: (bounds.minX + bounds.maxX) / 2 + ((localX - event.width / 2) / fit) * (mirrored ? -1 : 1),
			y: (bounds.minY + bounds.maxY) / 2 - (localY - event.height / 2) / fit,
			tolerance: 7 / Math.max(fit * event.zoom, 0.01)
		};
	}

	function hitPad(pcb: AltiumPcbDoc, x: number, y: number, tolerance: number) {
		for (const index of getPcbSpatialIndex(pcb).pads.query(x, y, tolerance)) {
			const candidate = pcb.pads[index];
			if (
				isLayerVisible(candidate.layer) &&
				Math.abs(x - candidate.x) <= candidate.size.x / 2 + tolerance &&
				Math.abs(y - candidate.y) <= candidate.size.y / 2 + tolerance
			)
				return candidate;
		}
		return undefined;
	}

	function hitTrack(pcb: AltiumPcbDoc, x: number, y: number, tolerance: number) {
		for (const index of getPcbSpatialIndex(pcb).tracks.query(x, y, tolerance)) {
			const candidate = pcb.tracks[index];
			if (
				isLayerVisible(candidate.layer) &&
				distanceToSegment(
					x,
					y,
					candidate.start.x,
					candidate.start.y,
					candidate.end.x,
					candidate.end.y
				) <=
					candidate.width / 2 + tolerance
			)
				return candidate;
		}
		return undefined;
	}

	function hitComponent(pcb: AltiumPcbDoc, x: number, y: number, tolerance: number) {
		for (const index of getPcbSpatialIndex(pcb).components.query(x, y, tolerance)) {
			const candidate = pcb.components[index];
			if (!isLayerVisible(candidate.layer)) continue;
			const b = candidate.bounds;
			const hit = b
				? x >= Math.min(b.x1, b.x2) - tolerance &&
					x <= Math.max(b.x1, b.x2) + tolerance &&
					y >= Math.min(b.y1, b.y2) - tolerance &&
					y <= Math.max(b.y1, b.y2) + tolerance
				: Math.hypot(x - candidate.x, y - candidate.y) <= 3 + tolerance;
			if (hit) return candidate;
		}
		return undefined;
	}

	function resolvePcbTooltip(event: CanvasClick) {
		const pcb = pcbB ?? pcbA;
		if (!pcb) return null;
		const { x, y, tolerance } = canvasToWorld(event);
		const pad = hitPad(pcb, x, y, tolerance * 0.65);
		if (pad) {
			const pin = pad.component ? `${pad.component}.${pad.designator}` : `Pad ${pad.designator}`;
			return pad.net ? `${pin} - ${pad.net}` : pin;
		}
		const track = hitTrack(pcb, x, y, tolerance * 0.65);
		if (track?.net) return `Net ${track.net}`;
		const component = hitComponent(pcb, x, y, tolerance * 0.5);
		return component
			? `${component.designator} - ${component.comment || component.footprint}`
			: null;
	}

	function applyFitTransform(
		ctx: CanvasRenderingContext2D,
		bounds: Bounds,
		canvasWidth: number,
		canvasHeight: number
	) {
		const dataWidth = Math.max(bounds.maxX - bounds.minX, 1);
		const dataHeight = Math.max(bounds.maxY - bounds.minY, 1);
		const fit = Math.min((canvasWidth - 64) / dataWidth, (canvasHeight - 64) / dataHeight);

		ctx.translate(canvasWidth / 2, canvasHeight / 2);
		ctx.scale(mirrored ? -fit : fit, -fit);
		ctx.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2);
	}

	function resolveSelectionFocus(width: number, height: number) {
		const pcb = pcbB ?? pcbA;
		if (!pcb) return null;
		let x: number | undefined;
		let y: number | undefined;
		if (projectStore.selectedDesignator) {
			const component = pcb.components.find(
				(candidate) =>
					candidate.designator.toUpperCase() === projectStore.selectedDesignator?.toUpperCase()
			);
			x = component?.x;
			y = component?.y;
		} else if (projectStore.selectedNet) {
			const net = projectStore.selectedNet.toUpperCase();
			const points = [
				...pcb.pads
					.filter((pad) => pad.net?.toUpperCase() === net)
					.map((pad) => ({ x: pad.x, y: pad.y })),
				...pcb.vias
					.filter((via) => via.net?.toUpperCase() === net)
					.map((via) => ({ x: via.x, y: via.y })),
				...pcb.tracks
					.filter((track) => track.net?.toUpperCase() === net)
					.flatMap((track) => [track.start, track.end])
			];
			if (points.length > 0) {
				x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
				y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
			}
		}
		if (x === undefined || y === undefined) return null;
		const bounds = pcbBounds;
		const fit = Math.min(
			(width - 64) / Math.max(bounds.maxX - bounds.minX, 1),
			(height - 64) / Math.max(bounds.maxY - bounds.minY, 1)
		);
		return {
			x: width / 2 + (x - (bounds.minX + bounds.maxX) / 2) * fit * (mirrored ? -1 : 1),
			y: height / 2 - (y - (bounds.minY + bounds.maxY) / 2) * fit,
			zoom: projectStore.selectedNet ? 2 : 4
		};
	}

	const focusKey = $derived(
		projectStore.selectedDesignator
			? `component:${projectStore.selectedDesignator}`
			: projectStore.selectedNet
				? `net:${projectStore.selectedNet}`
				: null
	);

	function drawDiffMode({
		ctx,
		width,
		height
	}: {
		ctx: CanvasRenderingContext2D;
		width: number;
		height: number;
	}) {
		const bounds = pcbBounds;
		ctx.save();
		applyFitTransform(ctx, bounds, width, height);
		drawDiff(ctx, projectStore.selectedDesignator);
		ctx.restore();
	}

	// ---- Side-by-side mode draw functions ----

	function drawVersionChanges(ctx: CanvasRenderingContext2D, side: 'A' | 'B') {
		const pick = <T,>(diff: { status: DiffStatus; before: T | null; after: T | null }) =>
			side === 'A' ? diff.before : diff.after;
		for (const diff of polygonDiff) {
			const polygon = pick(diff);
			if (!polygon || diff.status === 'unchanged' || !isLayerVisible(polygon.layer)) continue;
			drawPolygon(ctx, polygon, pcbDiffColor(diff.status), 0.1, 0.9);
		}
		for (const diff of trackDiff) {
			const track = pick(diff);
			if (!track || diff.status === 'unchanged' || !isLayerVisible(track.layer)) continue;
			drawTrack(ctx, track, pcbDiffColor(diff.status), 1);
		}
		for (const diff of arcDiff) {
			const arc = pick(diff);
			if (!arc || diff.status === 'unchanged' || !isLayerVisible(arc.layer)) continue;
			drawArc(ctx, arc, pcbDiffColor(diff.status), 1);
		}
		for (const diff of padDiff) {
			const pad = pick(diff);
			if (!pad || diff.status === 'unchanged' || !isLayerVisible(pad.layer)) continue;
			drawPad(ctx, pad, pcbDiffColor(diff.status), 1, showPin1Markers);
		}
		if (showVias) {
			for (const diff of viaDiff) {
				const via = pick(diff);
				if (!via || diff.status === 'unchanged' || !isViaVisible(via.startLayer, via.endLayer))
					continue;
				drawVia(ctx, via, pcbDiffColor(diff.status), 1);
			}
		}
		for (const diff of componentDiff) {
			const component = side === 'A' ? diff.before : diff.after;
			if (
				!component ||
				diff.status === 'unchanged' ||
				!isLayerVisible(component.layer) ||
				(!showComponents && !showDesignators)
			)
				continue;
			drawComponentLabel(
				ctx,
				component,
				pcbDiffColor(diff.status),
				0.48,
				showComponents,
				showDesignators
			);
		}
	}

	function makeSoloDraw(pcb: AltiumPcbDoc | null, side: 'A' | 'B') {
		return ({
			ctx,
			width: w,
			height: h
		}: {
			ctx: CanvasRenderingContext2D;
			width: number;
			height: number;
		}) => {
			if (!pcb) return;
			const bounds = pcbBounds;
			ctx.save();
			applyFitTransform(ctx, bounds, w, h);
			drawSoloPcb(ctx, pcb, {
				layers,
				isLayerVisible,
				layerOpacity,
				showComponents,
				showDesignators,
				showPlanes,
				showTexts,
				showVias,
				selected: projectStore.selectedDesignator,
				selectedNet: projectStore.selectedNet,
				neutralColors: projectStore.mode === 'compare',
				showPin1Markers
			});
			if (projectStore.mode === 'compare') drawVersionChanges(ctx, side);
			ctx.restore();
		};
	}

	const drawSideA = $derived(makeSoloDraw(pcbA, 'A'));
	const drawSideB = $derived(makeSoloDraw(pcbB, 'B'));

	// ---- Overlay mode draw functions ----

	type OverlayCache = { key: string; canvas: HTMLCanvasElement };
	let overlayCacheA: OverlayCache | null = null;
	let overlayCacheB: OverlayCache | null = null;

	function overlayCacheKey(
		side: 'A' | 'B',
		pcb: AltiumPcbDoc,
		width: number,
		height: number,
		zoom: number,
		panX: number,
		panY: number
	) {
		return JSON.stringify([
			side,
			pcb.fileName,
			pcb.fileSize,
			width,
			height,
			zoom,
			panX,
			panY,
			layers,
			visibleLayers,
			layerOpacities,
			showComponents,
			showDesignators,
			showPlanes,
			showTexts,
			showVias,
			showPin1Markers,
			mirrored,
			projectStore.selectedDesignator,
			projectStore.selectedNet
		]);
	}

	function getOverlayCache(
		side: 'A' | 'B',
		pcb: AltiumPcbDoc,
		width: number,
		height: number,
		zoom: number,
		panX: number,
		panY: number
	) {
		const key = overlayCacheKey(side, pcb, width, height, zoom, panX, panY);
		const current = side === 'A' ? overlayCacheA : overlayCacheB;
		if (current?.key === key) return current.canvas;

		const ratio = window.devicePixelRatio || 1;
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.floor(width * ratio));
		canvas.height = Math.max(1, Math.floor(height * ratio));
		const context = canvas.getContext('2d');
		if (!context) return canvas;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.fillStyle = '#111827';
		context.fillRect(0, 0, width, height);
		context.translate(panX, panY);
		context.scale(zoom, zoom);
		context.save();
		applyFitTransform(context, pcbBounds, width, height);
		drawSoloPcb(context, pcb, {
			layers,
			isLayerVisible,
			layerOpacity,
			showComponents,
			showDesignators,
			showPlanes,
			showTexts,
			showVias,
			selected: projectStore.selectedDesignator,
			selectedNet: projectStore.selectedNet,
			neutralColors: true,
			showPin1Markers
		});
		drawVersionChanges(context, side);
		context.restore();
		const next = { key, canvas };
		if (side === 'A') overlayCacheA = next;
		else overlayCacheB = next;
		return canvas;
	}

	function drawOverlay({
		ctx,
		width: w,
		height: h,
		zoom,
		panX,
		panY
	}: {
		ctx: CanvasRenderingContext2D;
		width: number;
		height: number;
		zoom: number;
		panX: number;
		panY: number;
	}) {
		const ratio = window.devicePixelRatio || 1;
		const canvasA = pcbA ? getOverlayCache('A', pcbA, w, h, zoom, panX, panY) : null;
		const canvasB = pcbB ? getOverlayCache('B', pcbB, w, h, zoom, panX, panY) : null;
		ctx.save();
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		if (canvasA) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, w * sliderPosition, h);
			ctx.clip();
			ctx.drawImage(canvasA, 0, 0, canvasA.width, canvasA.height, 0, 0, w, h);
			ctx.restore();
		}
		if (canvasB) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(w * sliderPosition, 0, w * (1 - sliderPosition), h);
			ctx.clip();
			ctx.drawImage(canvasB, 0, 0, canvasB.width, canvasB.height, 0, 0, w, h);
			ctx.restore();
		}

		// Draw slider line
		const sx = w * sliderPosition;
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 2;
		ctx.shadowColor = 'rgba(0,0,0,0.4)';
		ctx.shadowBlur = 4;
		ctx.beginPath();
		ctx.moveTo(sx, 0);
		ctx.lineTo(sx, h);
		ctx.stroke();

		// Draw labels
		ctx.shadowBlur = 0;
		ctx.font = 'bold 11px Inter, system-ui, sans-serif';
		ctx.textBaseline = 'top';
		ctx.fillStyle = 'rgba(255,255,255,0.92)';
		ctx.fillText('A', 8, 8);
		ctx.fillText('B', w - 16, 8);

		ctx.restore();
	}

	// Slider drag handlers
	let overlayContainer = $state<HTMLDivElement | null>(null);

	function onSliderDown(event: PointerEvent) {
		event.stopPropagation();
		isSliderDragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onSliderMove(event: PointerEvent) {
		if (!isSliderDragging || !overlayContainer) return;
		event.stopPropagation();
		const rect = overlayContainer.getBoundingClientRect();
		sliderPosition = Math.max(0.02, Math.min(0.98, (event.clientX - rect.left) / rect.width));
	}

	function onSliderUp(event: PointerEvent) {
		isSliderDragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	}

	function onPcbKeyDown(event: KeyboardEvent) {
		if (
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.key.toLowerCase() !== 'm' ||
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			event.target instanceof HTMLSelectElement
		)
			return;
		event.preventDefault();
		mirrored = !mirrored;
	}
</script>

<svelte:window onkeydown={onPcbKeyDown} />

<div class="pcb-view" class:minimal={projectStore.minimalUi}>
	<div class="layer-panel">
		{#if projectStore.mode === 'compare'}
			<div class="mode-selector">
				<h3>View Mode</h3>
				<div class="mode-buttons">
					<button class:active={viewMode === 'diff'} onclick={() => (viewMode = 'diff')}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"><path d="M12 3v18M3 12h18" /></svg
						>
						Diff
					</button>
					<button
						class:active={viewMode === 'side-by-side'}
						onclick={() => (viewMode = 'side-by-side')}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							><rect x="2" y="3" width="8" height="18" rx="1" /><rect
								x="14"
								y="3"
								width="8"
								height="18"
								rx="1"
							/></svg
						>
						A | B
					</button>
					<button class:active={viewMode === 'overlay'} onclick={() => (viewMode = 'overlay')}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							><rect x="2" y="3" width="20" height="18" rx="1" /><line
								x1="12"
								y1="3"
								x2="12"
								y2="21"
							/></svg
						>
						Slider
					</button>
				</div>
			</div>
		{/if}

		<button
			class="mirror-toggle"
			class:active={mirrored}
			title="Mirror PCB horizontally (M)"
			aria-pressed={mirrored}
			onclick={() => (mirrored = !mirrored)}
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"><path d="M12 3v18M9 6 4 12l5 6M15 6l5 6-5 6" /></svg
			>
			<span>{mirrored ? 'Mirrored' : 'Mirror PCB'}</span>
			<kbd>M</kbd>
		</button>

		<div class="layer-heading">
			<h3>Layers</h3>
			<div>
				<button onclick={() => setAllLayers(true)}>All</button>
				<button onclick={() => setAllLayers(false)}>None</button>
			</div>
		</div>
		{#if !projectStore.minimalUi}
			{#if projectStore.mode === 'compare'}
				<div class="legend">
					<span><i class="only-a"></i>Only A</span>
					<span><i class="only-b"></i>Only B</span>
					<span><i class="common"></i>Common</span>
					<span><i class="modified"></i>Modified</span>
				</div>
			{/if}
			<label class="toggle">
				<input type="checkbox" bind:checked={showComponents} />
				<span>Show component outlines</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showDesignators} />
				<span>Show designators</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showPlanes} />
				<span>Show copper planes</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showTexts} />
				<span>Show texts</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showVias} />
				<span>Show vias</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showPin1Markers} />
				<span>Show pin 1 markers</span>
			</label>
			<label class="toggle">
				<input type="checkbox" checked={profilingEnabled} onchange={toggleProfiling} />
				<span>Profile PCB rendering</span>
			</label>
		{/if}
		<div class="layers-list">
			{#each layers as layer}
				<div class="layer-control">
					<label>
						<input type="checkbox" bind:checked={visibleLayers[layer]} />
						<span><i style={`background: ${soloLayerColor(layer, layers)}`}></i>{layer}</span>
					</label>
					{#if !projectStore.minimalUi}
						<div class="opacity-control" class:disabled={!isLayerVisible(layer)}>
							<input
								type="range"
								min="5"
								max="100"
								step="5"
								value={Math.round(layerOpacity(layer) * 100)}
								disabled={!isLayerVisible(layer)}
								aria-label={`${layer} opacity`}
								oninput={(event) =>
									(layerOpacities[layer] =
										Number((event.currentTarget as HTMLInputElement).value) / 100)}
							/>
							<output>{Math.round(layerOpacity(layer) * 100)}%</output>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<div class="route-diff">
			<h3>Nets</h3>
			<select
				aria-label="Selected PCB net"
				value={projectStore.selectedNet ?? ''}
				onchange={(event) =>
					projectStore.selectNet((event.currentTarget as HTMLSelectElement).value || null)}
			>
				<option value="">No net selected</option>
				{#each activeIndex.nets as net}
					<option value={net}>{net}</option>
				{/each}
			</select>
			{#if selectedNetDetails}
				<section class="net-inspector">
					<header>
						<strong>{selectedNetDetails.name}</strong>
						<button aria-label="Clear selected net" onclick={() => projectStore.selectNet(null)}
							>×</button
						>
					</header>
					<div class="net-stats">
						<span>{selectedNetDetails.components.length} comps</span>
						<span>{selectedNetDetails.pads.length} pads</span>
						<span>{selectedNetDetails.tracks.length} tracks</span>
						<span>{selectedNetDetails.vias.length} vias</span>
						<span>{selectedNetDetails.polygons.length} planes</span>
					</div>
					{#each selectedNetComponents as component}
						<button
							class="net-component"
							class:selected={projectStore.selectedDesignator === component.designator}
							onclick={() => projectStore.selectDesignator(component.designator, true)}
						>
							<span>
								<strong>{component.designator}</strong>
								<small
									>{component.bom?.comment ??
										component.pcb?.comment ??
										component.pcb?.footprint ??
										''}</small
								>
							</span>
							{#if component.pinConnections.filter((pin) => pin.net.toUpperCase() === selectedNetDetails.name.toUpperCase()).length > 0}
								<small class="pin-list">
									{component.pinConnections
										.filter(
											(pin) => pin.net.toUpperCase() === selectedNetDetails.name.toUpperCase()
										)
										.map((pin) => `${pin.pinNumber}${pin.pinName ? ` ${pin.pinName}` : ''}`)
										.join(', ')}
								</small>
							{/if}
						</button>
					{/each}
				</section>
			{/if}
			{#if projectStore.mode === 'view'}
				<h3>Components</h3>
				<div class="route-counts">
					<span>{pcbA?.components.length ?? 0} components</span>
					<span>{pcbA?.tracks.length ?? 0} tracks</span>
					<span>{pcbA?.pads.length ?? 0} pads</span>
					<span>{pcbA?.vias.length ?? 0} vias</span>
				</div>
				{#each pcbA?.components ?? [] as component}
					<button
						class:selected={projectStore.selectedDesignator === component.designator}
						onclick={() => projectStore.selectDesignator(component.designator)}
					>
						<strong>{component.designator}</strong>
						<span>{component.comment}</span>
					</button>
				{/each}
			{:else}
				<h3>Routing diff</h3>
				<div class="route-counts">
					<span>{changedTracks.length} tracks</span>
					<span>{changedPads.length} pads</span>
					<span>{changedVias.length} vias</span>
					<span>{changedPolygons.length} planes</span>
					<span>{changedArcs.length} arcs</span>
					<span>{changedTexts.length} texts</span>
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
			{/if}
		</div>
	</div>

	{#if profilingEnabled}
		<div class="performance-hud" role="status">
			<strong>PCB render profile</strong>
			<span>Draw avg {performanceProfile.render.averageMs.toFixed(1)} ms</span>
			<span>max {performanceProfile.render.maximumMs.toFixed(1)} ms</span>
			<span>last {performanceProfile.render.lastMs.toFixed(1)} ms</span>
			<span>{performanceProfile.render.samples} frames</span>
			<span>Hit avg {performanceProfile.hitTest.averageMs.toFixed(2)} ms</span>
			<span>max {performanceProfile.hitTest.maximumMs.toFixed(2)} ms</span>
			<span>last {performanceProfile.hitTest.lastMs.toFixed(2)} ms</span>
			<span>{performanceProfile.hitTest.samples} hits</span>
			<button onclick={resetPerformanceProfile}>Reset</button>
		</div>
	{/if}

	{#if projectStore.mode === 'view'}
		<BaseCanvas
			background="#111827"
			draw={drawSideA}
			onCanvasClick={onPcbClick}
			resolveTooltip={resolvePcbTooltip}
			{focusKey}
			resolveFocus={resolveSelectionFocus}
			onPerformanceMetric={profilingEnabled ? recordPerformanceMetric : undefined}
		/>
	{:else if viewMode === 'diff'}
		<BaseCanvas
			background="#111827"
			draw={drawDiffMode}
			onCanvasClick={onPcbClick}
			resolveTooltip={resolvePcbTooltip}
			{focusKey}
			resolveFocus={resolveSelectionFocus}
			onPerformanceMetric={profilingEnabled ? recordPerformanceMetric : undefined}
		/>
	{:else if viewMode === 'side-by-side'}
		<div class="side-by-side">
			<div class="side-pane">
				<div class="side-label">Version A</div>
				<BaseCanvas
					background="#111827"
					draw={drawSideA}
					synced={true}
					bind:syncZoom
					bind:syncPanX
					bind:syncPanY
					onPerformanceMetric={profilingEnabled ? recordPerformanceMetric : undefined}
				/>
			</div>
			<div class="side-divider"></div>
			<div class="side-pane">
				<div class="side-label side-label-b">Version B</div>
				<BaseCanvas
					background="#111827"
					draw={drawSideB}
					synced={true}
					bind:syncZoom
					bind:syncPanX
					bind:syncPanY
					onPerformanceMetric={profilingEnabled ? recordPerformanceMetric : undefined}
				/>
			</div>
		</div>
	{:else if viewMode === 'overlay'}
		<div class="overlay-container" bind:this={overlayContainer}>
			<BaseCanvas
				background="#111827"
				draw={drawOverlay}
				onPerformanceMetric={profilingEnabled ? recordPerformanceMetric : undefined}
			/>
			<div
				class="overlay-slider"
				style={`left: ${sliderPosition * 100}%`}
				onpointerdown={onSliderDown}
				onpointermove={onSliderMove}
				onpointerup={onSliderUp}
				onpointercancel={onSliderUp}
				role="slider"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(sliderPosition * 100)}
				aria-label="Overlay slider"
				tabindex="0"
			>
				<div class="slider-handle">
					<svg width="12" height="20" viewBox="0 0 12 20" fill="none">
						<rect x="2" y="0" width="2" height="20" rx="1" fill="white" opacity="0.8" />
						<rect x="8" y="0" width="2" height="20" rx="1" fill="white" opacity="0.8" />
					</svg>
				</div>
			</div>
			<div class="overlay-label overlay-label-a">A</div>
			<div class="overlay-label overlay-label-b">B</div>
		</div>
	{/if}
</div>

<style>
	.pcb-view {
		position: relative;
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: 260px minmax(0, 1fr);
		min-height: 0;
	}

	.pcb-view.minimal {
		grid-template-columns: 205px minmax(0, 1fr);
	}

	.pcb-view.minimal .layer-panel {
		gap: 9px;
		padding: 9px;
	}

	.layer-panel {
		border-right: 1px solid #d5dbe5;
		background: #ffffff;
		padding: 14px;
		overflow: auto;
	}

	.mirror-toggle {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		border: 1px solid #dbe2ec;
		border-radius: 6px;
		background: #f8fafc;
		color: #475569;
		font-size: 0.7rem;
		font-weight: 800;
		padding: 7px 8px;
	}

	.mirror-toggle span {
		flex: 1;
		text-align: left;
	}

	.mirror-toggle kbd {
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		background: #ffffff;
		color: #64748b;
		font:
			700 0.58rem Inter,
			sans-serif;
		padding: 2px 5px;
	}

	.mirror-toggle:hover,
	.mirror-toggle.active {
		border-color: #818cf8;
		background: #eef2ff;
		color: #4f46e5;
	}

	.layer-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.layer-heading h3 {
		margin: 0;
	}

	.layer-heading > div {
		display: flex;
		gap: 3px;
	}

	.layer-heading button {
		border: 1px solid #dbe2ec;
		border-radius: 4px;
		background: #f8fafc;
		color: #64748b;
		cursor: pointer;
		font-size: 0.58rem;
		font-weight: 800;
		padding: 4px 6px;
	}

	.layer-heading button:hover {
		border-color: #a5b4fc;
		background: #eef2ff;
		color: #4f46e5;
	}

	.layers-list {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.pcb-view.minimal .layers-list {
		max-height: 190px;
		padding-right: 3px;
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

	.layer-control {
		border-bottom: 1px solid #eef2f6;
		padding: 3px 0 7px;
	}

	.opacity-control {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 38px;
		align-items: center;
		gap: 7px;
		padding-left: 24px;
		transition: opacity 120ms ease;
	}

	.opacity-control.disabled {
		opacity: 0.35;
	}

	.opacity-control input[type='range'] {
		width: 100%;
		accent-color: #2563eb;
	}

	.opacity-control output {
		color: #667085;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
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

	/* --- Mode selector --- */

	.mode-selector {
		margin-bottom: 14px;
		padding-bottom: 14px;
		border-bottom: 1px solid #e5e7eb;
	}

	.mode-buttons {
		display: flex;
		gap: 4px;
		background: #f1f5f9;
		border-radius: 8px;
		padding: 3px;
	}

	.mode-buttons button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border-radius: 6px;
		background: transparent;
		color: #526070;
		font-size: 0.74rem;
		font-weight: 800;
		min-height: 32px;
		padding: 0 6px;
		transition: all 140ms ease;
	}

	.mode-buttons button.active {
		background: #1f2937;
		color: #ffffff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
	}

	.mode-buttons button:hover:not(.active) {
		background: #e2e8f0;
	}

	/* --- Route diff --- */

	.route-diff {
		border-top: 1px solid #e5e7eb;
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
		padding-top: 12px;
	}

	.route-diff select {
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: #ffffff;
		color: #111827;
		padding: 7px 8px;
	}

	.net-inspector {
		display: flex;
		flex-direction: column;
		gap: 7px;
		border: 1px solid #bae6fd;
		border-radius: 7px;
		background: #f0f9ff;
		padding: 9px;
	}

	.net-inspector header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: #0c4a6e;
	}

	.net-inspector header button {
		flex: 0 0 24px;
		min-height: 24px;
		border: 0;
		background: transparent;
		color: #0369a1;
		font-size: 1.1rem;
		padding: 0;
	}

	.net-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		color: #475569;
		font-size: 0.7rem;
	}

	.net-stats span {
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.75);
		padding: 3px 5px;
	}

	.net-inspector .net-component {
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		border-left-color: #0284c7;
	}

	.net-component > span {
		display: flex;
		justify-content: space-between;
		gap: 6px;
	}

	.net-component small {
		color: #64748b;
		font-size: 0.68rem;
		font-weight: 600;
	}

	.net-component .pin-list {
		color: #0369a1;
		text-align: left;
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

	/* --- Side by side --- */

	.side-by-side {
		display: grid;
		grid-template-columns: 1fr 2px 1fr;
		min-height: 0;
		width: 100%;
		height: 100%;
	}

	.side-pane {
		position: relative;
		min-height: 0;
		min-width: 0;
	}

	.side-divider {
		background: #374151;
		width: 2px;
	}

	.side-label {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 2;
		border-radius: 5px;
		background: rgba(22, 163, 106, 0.88);
		color: #ffffff;
		font-size: 0.72rem;
		font-weight: 800;
		padding: 4px 10px;
		pointer-events: none;
		letter-spacing: 0.5px;
	}

	.side-label-b {
		background: rgba(220, 38, 38, 0.88);
		left: auto;
		right: 10px;
	}

	/* --- Overlay slider --- */

	.performance-hud {
		position: absolute;
		z-index: 8;
		top: 14px;
		right: 14px;
		display: grid;
		grid-template-columns: repeat(4, auto);
		align-items: center;
		gap: 4px 10px;
		padding: 9px 11px;
		border: 1px solid rgba(96, 165, 250, 0.35);
		border-radius: 8px;
		background: rgba(15, 23, 42, 0.9);
		color: #e2e8f0;
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
		font-size: 0.7rem;
		pointer-events: auto;
		backdrop-filter: blur(8px);
	}

	.performance-hud strong {
		grid-column: 1 / -1;
	}

	.performance-hud strong {
		color: #93c5fd;
	}

	.performance-hud button {
		grid-column: 4;
		border: 1px solid #475569;
		border-radius: 4px;
		background: #1e293b;
		color: #cbd5e1;
		padding: 3px 6px;
	}

	.overlay-container {
		position: relative;
		min-height: 0;
		min-width: 0;
		width: 100%;
		height: 100%;
	}

	.overlay-slider {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 28px;
		transform: translateX(-50%);
		cursor: col-resize;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		touch-action: none;
	}

	.slider-handle {
		width: 24px;
		height: 42px;
		border-radius: 8px;
		background: rgba(31, 41, 55, 0.85);
		border: 2px solid rgba(255, 255, 255, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		transition: background 120ms ease;
	}

	.overlay-slider:hover .slider-handle {
		background: rgba(31, 41, 55, 0.95);
		border-color: #ffffff;
	}

	.overlay-label {
		position: absolute;
		top: 10px;
		z-index: 2;
		border-radius: 5px;
		color: #ffffff;
		font-size: 0.72rem;
		font-weight: 800;
		padding: 4px 10px;
		pointer-events: none;
		letter-spacing: 0.5px;
	}

	.overlay-label-a {
		left: 10px;
		background: rgba(22, 163, 106, 0.88);
	}

	.overlay-label-b {
		right: 10px;
		background: rgba(220, 38, 38, 0.88);
	}
</style>
