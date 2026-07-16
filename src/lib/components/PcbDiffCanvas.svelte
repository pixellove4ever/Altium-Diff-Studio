<script lang="ts">
	import BaseCanvas, {
		type CanvasClick,
		type CanvasPerformanceMetric
	} from '$lib/components/BaseCanvas.svelte';
	import { getPcbDiffBundle, type DiffStatus } from '$lib/diff/altiumDiff';
	import { getPcbSpatialIndex } from '$lib/domain/pcbSpatialIndex';
	import {
		parsePcbDisplayPreferences,
		pcbLayerSide,
		projectPreferenceKey,
		visibleLayersForBasicBoardSide,
		visibleLayersForBoardSide,
		type PcbBoardSide,
		type PcbViewMode
	} from '$lib/domain/displayPreferences';
	import { isBusSelection, netMatchesSelection } from '$lib/domain/netSelection';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore, type PcbSelectionMode } from '$lib/state/viewerStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import type { AltiumPcbComponent, AltiumPcbDoc } from '$lib/types/altium';
	import {
		drawArc,
		drawBoardOutlineEdges,
		drawComponentLabel,
		drawPad,
		drawPcbText,
		drawPolygon,
		drawSelectedArc,
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
		viaAlpha,
		viaColor,
		type Bounds
	} from './pcbRenderer';

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
	// Footprint bounds are essential for large mechanical parts such as connectors.
	// Pads alone are not enough to make those components recognizable.
	let showComponents = $state(true);
	let showDesignators = $state(false);
	let showPlanes = $state(true);
	let showTexts = $state(false);
	let showVias = $state(false);
	let showPin1Markers = $state(false);
	const renderShowComponents = $derived(!viewerStore.minimalUi && showComponents);
	const renderShowDesignators = $derived(!viewerStore.minimalUi && showDesignators);
	const renderShowPlanes = $derived(showPlanes);
	const renderShowTexts = $derived(!viewerStore.minimalUi && showTexts);
	const renderShowVias = $derived(viewerStore.minimalUi ? true : showVias);
	const renderShowPin1Markers = $derived(!viewerStore.minimalUi && showPin1Markers);
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
	let viewMode = $state<PcbViewMode>('diff');
	let boardSide = $state<PcbBoardSide>('all');
	let loadedPreferenceKey = $state('');
	let hoveredDesignator = $state<string | null>(null);

	// Synced zoom/pan for side-by-side mode
	let syncZoom = $state(1);
	let syncPanX = $state(0);
	let syncPanY = $state(0);

	// Overlay slider position (0-1, where 0.5 = center)
	let sliderPosition = $state(0.5);
	let isSliderDragging = $state(false);
	let lastLayerFocusedDesignator = $state('');

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
	const preferenceKey = $derived(projectPreferenceKey(projectStore.filesA, projectStore.filesB));

	$effect(() => {
		const key = preferenceKey;
		if (!key || layers.length === 0 || key === loadedPreferenceKey) return;
		const preferences = parsePcbDisplayPreferences(window.localStorage.getItem(key), layers);
		visibleLayers = preferences.visibleLayers;
		layerOpacities = preferences.layerOpacities;
		viewMode = preferences.viewMode;
		boardSide = preferences.boardSide;
		showComponents = preferences.showComponents;
		showDesignators = preferences.showDesignators;
		showPlanes = preferences.showPlanes;
		showTexts = preferences.showTexts;
		showVias = preferences.showVias;
		showPin1Markers = preferences.showPin1Markers;
		mirrored = preferences.mirrored;
		sliderPosition = preferences.sliderPosition;
		loadedPreferenceKey = key;
	});

	$effect(() => {
		if (!loadedPreferenceKey || loadedPreferenceKey !== preferenceKey) return;
		window.localStorage.setItem(
			loadedPreferenceKey,
			JSON.stringify({
				version: 1,
				visibleLayers,
				layerOpacities,
				viewMode,
				boardSide,
				showComponents,
				showDesignators,
				showPlanes,
				showTexts,
				showVias,
				showPin1Markers,
				mirrored,
				sliderPosition
			})
		);
	});

	$effect(() => {
		if (viewerStore.minimalUi && boardSide !== 'top' && boardSide !== 'bottom') {
			boardSide = 'top';
			mirrored = false;
			visibleLayers = visibleLayersForBasicBoardSide(layers, 'top');
			return;
		}
		if (boardSide === 'top' || boardSide === 'bottom') {
			if (viewerStore.minimalUi) mirrored = boardSide === 'bottom';
			visibleLayers = viewerStore.minimalUi
				? visibleLayersForBasicBoardSide(layers, boardSide)
				: visibleLayersForBoardSide(layers, boardSide);
			return;
		}
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
		if (!selected) {
			lastLayerFocusedDesignator = '';
			return;
		}
		if (selected === lastLayerFocusedDesignator) return;
		lastLayerFocusedDesignator = selected;
		const component =
			pcbB?.components.find((candidate) => candidate.designator.toUpperCase() === selected) ??
			pcbA?.components.find((candidate) => candidate.designator.toUpperCase() === selected);
		if (!component || visibleLayers[component.layer] !== false) return;
		if (viewerStore.minimalUi) {
			const side = pcbLayerSide(component.layer);
			if (side === 'top' || side === 'bottom') {
				boardSide = side;
				mirrored = side === 'bottom';
				visibleLayers = visibleLayersForBasicBoardSide(layers, side);
			}
			return;
		}
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

	function isInBasicRenderBounds(points: Array<{ x: number; y: number }>, margin = 2) {
		if (!viewerStore.minimalUi || points.length === 0) return true;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const point of points) {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
		const bounds = pcbBounds;
		return (
			maxX >= bounds.minX - margin &&
			minX <= bounds.maxX + margin &&
			maxY >= bounds.minY - margin &&
			minY <= bounds.maxY + margin
		);
	}

	function padBoundsPoints(pad: { x: number; y: number; size: { x: number; y: number } }) {
		const halfWidth = Math.max(pad.size.x / 2, 0.25);
		const halfHeight = Math.max(pad.size.y / 2, 0.25);
		return [
			{ x: pad.x - halfWidth, y: pad.y - halfHeight },
			{ x: pad.x + halfWidth, y: pad.y + halfHeight }
		];
	}

	function componentBoundsPoints(component: {
		x: number;
		y: number;
		bounds?: { x1: number; y1: number; x2: number; y2: number };
	}) {
		if (!component.bounds) return [{ x: component.x, y: component.y }];
		return [
			{ x: component.bounds.x1, y: component.bounds.y1 },
			{ x: component.bounds.x2, y: component.bounds.y2 }
		];
	}

	function setAllLayers(visible: boolean) {
		visibleLayers = Object.fromEntries(layers.map((layer) => [layer, visible]));
		boardSide = visible ? 'all' : 'custom';
	}

	function applyBoardSide(side: PcbBoardSide) {
		boardSide = side;
		if (viewerStore.minimalUi && (side === 'top' || side === 'bottom'))
			mirrored = side === 'bottom';
		visibleLayers = viewerStore.minimalUi
			? visibleLayersForBasicBoardSide(layers, side)
			: visibleLayersForBoardSide(layers, side);
	}

	function setLayerVisible(layer: string, visible: boolean) {
		visibleLayers = { ...visibleLayers, [layer]: visible };
		boardSide = 'custom';
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

	function findComponentByDesignator(designator: string | null) {
		if (!designator) return undefined;
		const selected = designator.toUpperCase();
		return (
			pcbB?.components.find((candidate) => candidate.designator.toUpperCase() === selected) ??
			pcbA?.components.find((candidate) => candidate.designator.toUpperCase() === selected)
		);
	}

	function screenPixelsToWorld(ctx: CanvasRenderingContext2D, pixels: number) {
		const transform = ctx.getTransform();
		const scale = Math.max(Math.hypot(transform.a, transform.b), 0.01);
		return pixels / scale;
	}

	function mixChannel(channel: number, target: number, ratio: number) {
		return Math.round(channel + (target - channel) * ratio);
	}

	function rgbToHex(channels: number[]) {
		return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
	}

	function complementaryLayerHighlight(layer: string, mixWithWhite = 0.16) {
		const color = soloLayerColor(layer, layers);
		const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
		if (!match) return '#67e8f9';
		const complement = match
			.slice(1)
			.map((channel) => 255 - Number.parseInt(channel, 16))
			.map((channel) => mixChannel(channel, 255, mixWithWhite));
		return rgbToHex(complement);
	}

	function drawComponentOutline(
		ctx: CanvasRenderingContext2D,
		component: AltiumPcbComponent,
		variant: 'hover' | 'selected'
	) {
		const lineWidth = screenPixelsToWorld(ctx, variant === 'selected' ? 1.8 : 1.2);
		const padding = screenPixelsToWorld(ctx, variant === 'selected' ? 3 : 2);
		const bounds = component.bounds;
		const highlightColor = complementaryLayerHighlight(
			component.layer,
			variant === 'selected' ? 0.1 : 0.28
		);

		function strokeBoundsOutline(
			rect: NonNullable<AltiumPcbComponent['bounds']>,
			extraPadding = 0
		) {
			const x1 = Math.min(rect.x1, rect.x2) - padding;
			const y1 = Math.min(rect.y1, rect.y2) - padding;
			const x2 = Math.max(rect.x1, rect.x2) + padding;
			const y2 = Math.max(rect.y1, rect.y2) + padding;
			ctx.strokeRect(
				x1 - extraPadding,
				y1 - extraPadding,
				x2 - x1 + extraPadding * 2,
				y2 - y1 + extraPadding * 2
			);
		}

		ctx.save();

		if (variant === 'selected') {
			ctx.strokeStyle = highlightColor;
			ctx.lineWidth = screenPixelsToWorld(ctx, 7);
			ctx.shadowColor = highlightColor;
			ctx.shadowBlur = 10;
			ctx.globalAlpha = 0.28;
			if (bounds) strokeBoundsOutline(bounds, screenPixelsToWorld(ctx, 2));
			else {
				ctx.translate(component.x, component.y);
				ctx.rotate((component.rotation * Math.PI) / 180);
				ctx.strokeRect(-2.4 - padding, -1.4 - padding, 4.8 + padding * 2, 2.8 + padding * 2);
				ctx.rotate((-component.rotation * Math.PI) / 180);
				ctx.translate(-component.x, -component.y);
			}
		}

		ctx.strokeStyle = highlightColor;
		ctx.lineWidth = lineWidth;
		ctx.shadowColor = highlightColor;
		ctx.shadowBlur = variant === 'selected' ? 4 : 2;
		ctx.globalAlpha = variant === 'selected' ? 0.95 : 0.82;

		if (bounds) {
			strokeBoundsOutline(bounds);
		} else {
			ctx.translate(component.x, component.y);
			ctx.rotate((component.rotation * Math.PI) / 180);
			ctx.strokeRect(-2.4 - padding, -1.4 - padding, 4.8 + padding * 2, 2.8 + padding * 2);
		}

		ctx.restore();
	}

	function drawSelectedComponentOutline(ctx: CanvasRenderingContext2D, pcb?: AltiumPcbDoc | null) {
		const selected = projectStore.selectedDesignator?.toUpperCase();
		const component = selected
			? (pcb?.components.find((candidate) => candidate.designator.toUpperCase() === selected) ??
				findComponentByDesignator(projectStore.selectedDesignator))
			: undefined;
		if (!component || !isLayerVisible(component.layer)) return;
		drawComponentOutline(ctx, component, 'selected');
	}

	function drawHoveredComponentOutline(ctx: CanvasRenderingContext2D) {
		if (viewerStore.pcbSelectionMode !== 'component') return;
		if (
			!hoveredDesignator ||
			hoveredDesignator.toUpperCase() === projectStore.selectedDesignator?.toUpperCase()
		)
			return;
		const component = findComponentByDesignator(hoveredDesignator);
		if (!component || !isLayerVisible(component.layer)) return;
		drawComponentOutline(ctx, component, 'hover');
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

	function drawDiff(ctx: CanvasRenderingContext2D) {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.font = '2.8px Inter, system-ui, sans-serif';

		if (renderShowPlanes) {
			for (const { item: polygon, status } of polygonDiff) {
				if (!isLayerVisible(polygon.layer)) continue;
				if (!isInBasicRenderBounds(polygon.vertices)) continue;
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
			if (!isInBasicRenderBounds([track.start, track.end])) continue;
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
			if (
				!isInBasicRenderBounds([
					{ x: arc.center.x - arc.radius, y: arc.center.y - arc.radius },
					{ x: arc.center.x + arc.radius, y: arc.center.y + arc.radius }
				])
			)
				continue;
			drawArc(
				ctx,
				arc,
				layerColor(arc.layer, status),
				pcbAlpha(status, 'line') * layerOpacity(arc.layer)
			);
		}

		ctx.globalAlpha = 1;

		for (const { item: pad, status } of activePads) {
			if (!isInBasicRenderBounds(padBoundsPoints(pad))) continue;
			drawPad(
				ctx,
				pad,
				pcbDiffColor(status),
				pcbAlpha(status, 'line') * layerOpacity(pad.layer),
				renderShowPin1Markers
			);
		}

		if (renderShowVias) {
			for (const { item: via, status } of viaDiff) {
				if (!isViaVisible(via.startLayer, via.endLayer)) continue;
				if (
					!isInBasicRenderBounds([
						{ x: via.x - via.diameter / 2, y: via.y - via.diameter / 2 },
						{ x: via.x + via.diameter / 2, y: via.y + via.diameter / 2 }
					])
				)
					continue;
				drawVia(ctx, via, viaColor(status), viaAlpha(status) * layerOpacity(via.startLayer));
			}
		}
		ctx.globalAlpha = 1;

		if (renderShowComponents || renderShowDesignators) {
			for (const diff of componentDiff) {
				const component = diff.after ?? diff.before;
				if (!component) continue;
				if (!isLayerVisible(component.layer)) continue;
				if (!isInBasicRenderBounds(componentBoundsPoints(component))) continue;
				ctx.globalAlpha = pcbAlpha(diff.status, 'component') * layerOpacity(component.layer);
				drawComponentLabel(
					ctx,
					component,
					pcbDiffColor(diff.status),
					diff.status === 'modified' ? 0.45 : 0.28,
					renderShowComponents,
					renderShowDesignators
				);
			}
			ctx.globalAlpha = 1;
		}

		// Texts
		if (renderShowTexts) {
			for (const { item: text, status } of textDiff) {
				if (!isLayerVisible(text.layer)) continue;
				if (!isInBasicRenderBounds([{ x: text.x, y: text.y }])) continue;
				const textPcb = pcbB ?? pcbA;
				const isDesignator =
					text.role === 'designator' ||
					(!text.role &&
						(textPcb?.components.some(
							(component) => component.designator.toUpperCase() === text.text.trim().toUpperCase()
						) ??
							false));
				if (isDesignator && !renderShowDesignators) continue;
				drawPcbText(
					ctx,
					text,
					pcbDiffColor(status),
					pcbAlpha(status, 'line') * layerOpacity(text.layer)
				);
			}
		}

		drawBoardOutlineEdges(ctx, pcbB ?? pcbA);

		const selectedNet = projectStore.selectedNet;
		if (selectedNet) {
			const selectedStyle = isBusSelection(selectedNet) ? 'group' : 'normal';
			const pcb = pcbB ?? pcbA;
			if (pcb) {
				for (const polygon of pcb.polygons ?? []) {
					if (netMatchesSelection(polygon.net, selectedNet))
						drawPolygon(ctx, polygon, selectedLayerColor(polygon.layer, layers), 0.38, 1);
				}
				for (const track of pcb.tracks) {
					if (netMatchesSelection(track.net, selectedNet))
						drawSelectedTrack(ctx, track, selectedLayerColor(track.layer, layers), selectedStyle);
				}
				for (const arc of pcb.arcs ?? []) {
					if (netMatchesSelection(arc.net, selectedNet))
						drawSelectedArc(ctx, arc, selectedLayerColor(arc.layer, layers), selectedStyle);
				}
				for (const via of pcb.vias) {
					if (netMatchesSelection(via.net, selectedNet))
						drawSelectedVia(ctx, via, selectedLayerColor(via.startLayer, layers), selectedStyle);
				}
				for (const pad of pcb.pads) {
					if (netMatchesSelection(pad.net, selectedNet))
						drawSelectedPad(
							ctx,
							pad,
							selectedLayerColor(pad.layer, layers),
							renderShowPin1Markers,
							selectedStyle
						);
				}
			}
		}

		drawSelectedComponentOutline(ctx);
		drawHoveredComponentOutline(ctx);
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

		if (viewerStore.pcbSelectionMode === 'track') {
			const track = hitTrack(pcb, x, y, tolerance);
			if (track?.net) {
				projectStore.selectNet(track.net);
				return;
			}
			const pad = hitPad(pcb, x, y, tolerance);
			projectStore.selectNet(pad?.net ?? null);
			return;
		}

		const pad = hitPad(pcb, x, y, tolerance);
		if (pad?.component) {
			projectStore.selectDesignator(pad.component);
			return;
		}
		const component = hitComponent(pcb, x, y, tolerance);
		projectStore.selectDesignator(component?.designator ?? null);
	}

	function setPcbSelectionMode(mode: PcbSelectionMode) {
		if (viewerStore.pcbSelectionMode === mode) return;
		viewerStore.pcbSelectionMode = mode;
		if (mode === 'component') projectStore.selectDesignator(projectStore.selectedDesignator);
		else projectStore.selectNet(projectStore.selectedNet);
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
		hoveredDesignator = null;
		const pad = hitPad(pcb, x, y, tolerance * 0.65);
		if (pad) {
			if (viewerStore.pcbSelectionMode === 'component') hoveredDesignator = pad.component ?? null;
			const pin = pad.component ? `${pad.component}.${pad.designator}` : `Pad ${pad.designator}`;
			return pad.net ? `${pin} - ${pad.net}` : pin;
		}
		const track = hitTrack(pcb, x, y, tolerance * 0.65);
		if (track?.net) return `Net ${track.net}`;
		const component = hitComponent(pcb, x, y, tolerance * 0.5);
		if (viewerStore.pcbSelectionMode === 'component') {
			hoveredDesignator = component?.designator ?? null;
		}
		return component
			? `${component.designator} - ${component.comment || component.footprint}`
			: null;
	}

	function clearPcbHover() {
		hoveredDesignator = null;
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
			const net = projectStore.selectedNet;
			const points = [
				...pcb.pads
					.filter((pad) => netMatchesSelection(pad.net, net))
					.map((pad) => ({ x: pad.x, y: pad.y })),
				...pcb.vias
					.filter((via) => netMatchesSelection(via.net, net))
					.map((via) => ({ x: via.x, y: via.y })),
				...pcb.tracks
					.filter((track) => netMatchesSelection(track.net, net))
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
		drawDiff(ctx);
		ctx.restore();
	}

	// ---- Side-by-side mode draw functions ----

	function drawVersionChanges(ctx: CanvasRenderingContext2D, side: 'A' | 'B') {
		const pick = <T,>(diff: { status: DiffStatus; before: T | null; after: T | null }) =>
			side === 'A' ? diff.before : diff.after;
		if (renderShowPlanes) {
			for (const diff of polygonDiff) {
				const polygon = pick(diff);
				if (!polygon || diff.status === 'unchanged' || !isLayerVisible(polygon.layer)) continue;
				drawPolygon(ctx, polygon, pcbDiffColor(diff.status), 0.1, 0.9);
			}
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
			drawPad(ctx, pad, pcbDiffColor(diff.status), 1, renderShowPin1Markers);
		}
		if (renderShowVias) {
			for (const diff of viaDiff) {
				const via = pick(diff);
				if (!via || diff.status === 'unchanged' || !isViaVisible(via.startLayer, via.endLayer))
					continue;
				drawVia(ctx, via, viaColor(diff.status), viaAlpha(diff.status));
			}
		}
		for (const diff of componentDiff) {
			const component = side === 'A' ? diff.before : diff.after;
			if (
				!component ||
				diff.status === 'unchanged' ||
				!isLayerVisible(component.layer) ||
				(!renderShowComponents && !renderShowDesignators)
			)
				continue;
			drawComponentLabel(
				ctx,
				component,
				pcbDiffColor(diff.status),
				0.48,
				renderShowComponents,
				renderShowDesignators
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
				showComponents: renderShowComponents,
				showDesignators: renderShowDesignators,
				showPlanes: renderShowPlanes,
				showTexts: renderShowTexts,
				showVias: renderShowVias,
				selected: null,
				selectedNet: projectStore.selectedNet,
				neutralColors: projectStore.mode === 'compare',
				showPin1Markers: renderShowPin1Markers,
				renderBounds: viewerStore.minimalUi ? bounds : null
			});
			if (projectStore.mode === 'compare') drawVersionChanges(ctx, side);
			drawSelectedComponentOutline(ctx, pcb);
			drawHoveredComponentOutline(ctx);
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
			renderShowComponents,
			renderShowDesignators,
			renderShowPlanes,
			renderShowTexts,
			renderShowVias,
			renderShowPin1Markers,
			mirrored,
			viewerStore.minimalUi,
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
			showComponents: renderShowComponents,
			showDesignators: renderShowDesignators,
			showPlanes: renderShowPlanes,
			showTexts: renderShowTexts,
			showVias: renderShowVias,
			selected: null,
			selectedNet: projectStore.selectedNet,
			neutralColors: true,
			showPin1Markers: renderShowPin1Markers,
			renderBounds: viewerStore.minimalUi ? pcbBounds : null
		});
		drawVersionChanges(context, side);
		drawSelectedComponentOutline(context, pcb);
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
			viewerStore.minimalUi ||
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

<div class="pcb-view" class:minimal={viewerStore.minimalUi}>
	<div class="layer-panel">
		<div class="mode-selector selection-mode-selector">
			<h3>Selection</h3>
			<div class="mode-buttons">
				<button
					class:active={viewerStore.pcbSelectionMode === 'component'}
					onclick={() => setPcbSelectionMode('component')}
				>
					Component
				</button>
				<button
					class:active={viewerStore.pcbSelectionMode === 'track'}
					onclick={() => setPcbSelectionMode('track')}
				>
					Track
				</button>
			</div>
		</div>

		{#if projectStore.mode === 'compare' && !viewerStore.minimalUi}
			<div class="mode-selector">
				<h3>{localeStore.t('pcb.viewMode')}</h3>
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
						{localeStore.t('pcb.slider')}
					</button>
				</div>
			</div>
		{/if}

		{#if !viewerStore.minimalUi}
			<button
				class="mirror-toggle"
				class:active={mirrored}
				title={`${localeStore.t('pcb.mirror')} (M)`}
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
				<span>{mirrored ? localeStore.t('pcb.mirrored') : localeStore.t('pcb.mirror')}</span>
				<kbd>M</kbd>
			</button>
		{/if}

		{#if !viewerStore.minimalUi}
			<div class="layer-heading">
				<h3>{localeStore.t('pcb.layers')}</h3>
				<div>
					<button onclick={() => setAllLayers(true)}>{localeStore.t('pcb.all')}</button>
					<button onclick={() => setAllLayers(false)}>{localeStore.t('pcb.none')}</button>
				</div>
			</div>
		{/if}
		<div class="board-side-selector" class:minimal={viewerStore.minimalUi} aria-label="PCB side">
			{#if !viewerStore.minimalUi}
				<button class:active={boardSide === 'all'} onclick={() => applyBoardSide('all')}>All</button
				>
			{/if}
			<button class:active={boardSide === 'top'} onclick={() => applyBoardSide('top')}>Top</button>
			<button class:active={boardSide === 'bottom'} onclick={() => applyBoardSide('bottom')}
				>Bottom</button
			>
		</div>
		{#if viewerStore.minimalUi}
			<label class="simple-plane-toggle">
				<input type="checkbox" bind:checked={showPlanes} />
				<span>{localeStore.t('pcb.showPlanes')}</span>
			</label>
		{/if}
		{#if !viewerStore.minimalUi}
			{#if projectStore.mode === 'compare'}
				<div class="legend">
					<span><i class="only-a"></i>{localeStore.t('pcb.onlyA')}</span>
					<span><i class="only-b"></i>{localeStore.t('pcb.onlyB')}</span>
					<span><i class="common"></i>{localeStore.t('pcb.common')}</span>
					<span><i class="modified"></i>{localeStore.t('bom.modified')}</span>
				</div>
			{/if}
			<label class="toggle">
				<input type="checkbox" bind:checked={showComponents} />
				<span>{localeStore.t('pcb.showComponents')}</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showDesignators} />
				<span>{localeStore.t('pcb.showDesignators')}</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showPlanes} />
				<span>{localeStore.t('pcb.showPlanes')}</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showTexts} />
				<span>{localeStore.t('pcb.showTexts')}</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showVias} />
				<span>{localeStore.t('pcb.showVias')}</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={showPin1Markers} />
				<span>{localeStore.t('pcb.showPin1')}</span>
			</label>
			<label class="toggle">
				<input type="checkbox" checked={profilingEnabled} onchange={toggleProfiling} />
				<span>Profile PCB rendering</span>
			</label>
		{/if}
		{#if !viewerStore.minimalUi}
			<div class="layers-list">
				{#each layers as layer}
					<div class="layer-control">
						<label>
							<input
								type="checkbox"
								checked={isLayerVisible(layer)}
								onchange={(event) =>
									setLayerVisible(layer, (event.currentTarget as HTMLInputElement).checked)}
							/>
							<span><i style={`background: ${soloLayerColor(layer, layers)}`}></i>{layer}</span>
						</label>
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
					</div>
				{/each}
			</div>
		{/if}
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
			onCanvasLeave={clearPcbHover}
			resolveTooltip={resolvePcbTooltip}
			redrawKey={hoveredDesignator}
			{focusKey}
			resolveFocus={resolveSelectionFocus}
			onPerformanceMetric={profilingEnabled ? recordPerformanceMetric : undefined}
		/>
	{:else if viewMode === 'diff'}
		<BaseCanvas
			background="#111827"
			draw={drawDiffMode}
			onCanvasClick={onPcbClick}
			onCanvasLeave={clearPcbHover}
			resolveTooltip={resolvePcbTooltip}
			redrawKey={hoveredDesignator}
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
					onCanvasClick={onPcbClick}
					onCanvasLeave={clearPcbHover}
					resolveTooltip={resolvePcbTooltip}
					redrawKey={hoveredDesignator}
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
					onCanvasClick={onPcbClick}
					onCanvasLeave={clearPcbHover}
					resolveTooltip={resolvePcbTooltip}
					redrawKey={hoveredDesignator}
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

	.board-side-selector {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 3px;
		border: 1px solid #dbe2ec;
		border-radius: 7px;
		background: #f8fafc;
		padding: 3px;
	}

	.board-side-selector.minimal {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.board-side-selector button {
		min-height: 28px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: #64748b;
		font-size: 0.68rem;
		font-weight: 850;
	}

	.board-side-selector button:hover {
		background: #e2e8f0;
	}

	.board-side-selector button.active {
		background: #1f2937;
		color: #ffffff;
	}

	.simple-plane-toggle {
		justify-content: center;
		min-height: 32px;
		border: 1px solid #dbe2ec;
		border-radius: 7px;
		background: #f8fafc;
		color: #475569;
		font-size: 0.72rem;
		font-weight: 850;
		padding: 0 8px;
	}

	.simple-plane-toggle input {
		margin: 0;
		accent-color: #1f2937;
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
