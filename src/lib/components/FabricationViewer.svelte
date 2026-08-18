<script lang="ts">
	import {
		compareGerberFiles,
		gerberLayerLabel,
		normalizeGerberLines,
		parseGerberGeometry,
		type GerberBounds,
		type GerberFile,
		type GerberGeometry,
		type GerberPrimitive
	} from '$lib/diff/fabrication/gerberDiff';
	import {
		compareOdbPackages,
		hasUsableOdbPackage,
		odbPrimitiveSignature,
		type OdbDiffStatus
	} from '$lib/diff/fabrication/odbDiff';
	import {
		type OdbBounds,
		type OdbComponentPlacement,
		type OdbLayerPreview,
		type OdbLayerType,
		type OdbLayerVisualPrimitive,
		type OdbPackageFile
	} from '$lib/domain/fabrication/files';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';
	import SvgPanZoom from '$lib/components/SvgPanZoom.svelte';

	let {
		files = projectStore.gerberA,
		odbPackages = projectStore.odbA
	}: { files?: GerberFile[]; odbPackages?: OdbPackageFile[] } = $props();

	let selectedKey = $state('');
	let selectedOdbLayerKey = $state('');
	let hiddenLayers = $state(new Set<string>());
	let hiddenGerberLayers = $state(new Set<string>());
	let collapsedGerberGroups = $state(new Set<string>());
	let collapsedOdbGroups = $state(new Set<string>());
	let appliedOdbDefaultVisibilityKey = $state('');
	type OdbViewLayer = {
		key: string;
		packageName: string;
		layer: string;
		type: OdbLayerType;
		featureCount: number;
		preview: OdbLayerPreview | null;
	};
	const odbLayerTypeLabels: Record<OdbLayerType, string> = {
		copper: 'Copper',
		mask: 'Mask',
		paste: 'Paste',
		silk: 'Silk',
		drill: 'Drill',
		outline: 'Outline',
		mechanical: 'Mechanical',
		document: 'Document',
		unknown: 'Other'
	};

	// ODB layer color palette by type
	const odbLayerColors: Record<string, string> = {
		copper: '#ef4444',
		mask: '#a855f7',
		paste: '#9ca3af',
		silk: '#d97706',
		drill: '#06b6d4',
		outline: '#84cc16',
		mechanical: '#64748b',
		document: '#94a3b8',
		unknown: '#6b7280'
	};
	function odbLayerColor(layer: { type: string; layer: string }): string {
		const name = layer.layer.toLowerCase();
		if (layer.type === 'copper') {
			if (/(top|front|fcu|f_cu|l1)/.test(name)) return '#ef4444';
			if (/(bot|back|bcu|b_cu)/.test(name)) return '#1d4ed8';
			const midMatch = /(mid|l)(\d+)/.exec(name);
			if (midMatch) {
				const palette = ['#ea580c', '#b45309', '#16a34a', '#0891b2', '#8b5cf6', '#db2777'];
				return palette[(parseInt(midMatch[2]) - 1) % palette.length];
			}
			return '#ea580c';
		}
		return odbLayerColors[layer.type] ?? '#6b7280';
	}

	type OdbLayerGroup = { name: string; key: string; layers: OdbViewLayer[] };
	const ODB_GROUP_ORDER = [
		'copper',
		'mask',
		'silk',
		'paste',
		'drill',
		'outline',
		'mechanical',
		'document',
		'unknown'
	];
	const odbLayerGroups = $derived.by((): OdbLayerGroup[] => {
		const map = new Map<string, OdbLayerGroup>();
		for (const layer of visibleOdbLayers) {
			const t = layer.type as string;
			if (!map.has(t))
				map.set(t, {
					name: odbLayerTypeLabels[layer.type as keyof typeof odbLayerTypeLabels] ?? t,
					key: t,
					layers: []
				});
			map.get(t)!.layers.push(layer);
		}
		return ODB_GROUP_ORDER.map((k) => map.get(k)).filter((g): g is OdbLayerGroup => !!g);
	});
	function toggleOdbGroup(groupKey: string) {
		const next = new Set(collapsedOdbGroups);
		if (next.has(groupKey)) next.delete(groupKey);
		else next.add(groupKey);
		collapsedOdbGroups = next;
	}
	function toggleOdbGroupVisibility(groupKey: string, e: Event) {
		(e as MouseEvent).stopPropagation();
		const group = odbLayerGroups.find((g) => g.key === groupKey);
		if (!group) return;
		const allHidden = group.layers.every((l) => hiddenLayers.has(l.key));
		const next = new Set(hiddenLayers);
		if (allHidden) group.layers.forEach((l) => next.delete(l.key));
		else group.layers.forEach((l) => next.add(l.key));
		hiddenLayers = next;
	}
	function toggleOdbLayerEye(layerKey: string, e: Event) {
		(e as MouseEvent).stopPropagation();
		const next = new Set(hiddenLayers);
		if (next.has(layerKey)) next.delete(layerKey);
		else next.add(layerKey);
		hiddenLayers = next;
	}
	const visibleOdbLayers = $derived.by(() =>
		odbLayers
			.filter((layer) => layer.preview?.bounds && layer.preview.primitives.length > 0)
			.sort(
				(left, right) =>
					signalLayerRank(left) - signalLayerRank(right) ||
					left.layer.localeCompare(right.layer, undefined, { numeric: true })
			)
	);
	function isolateOdbLayer(layerKey: string) {
		selectedKey = '__odb_board__';
		selectedOdbLayerKey = layerKey;
		const newHidden = new Set(visibleOdbLayers.map((l) => l.key));
		newHidden.delete(layerKey);
		hiddenLayers = newHidden;
	}
	const allOdbLayersHidden = $derived(
		visibleOdbLayers.length > 0 && visibleOdbLayers.every((l) => hiddenLayers.has(l.key))
	);
	function toggleAllOdbLayers() {
		if (allOdbLayersHidden) {
			hiddenLayers = new Set();
		} else {
			hiddenLayers = new Set(visibleOdbLayers.map((l) => l.key));
		}
		selectedKey = '__odb_board__';
	}
	// Gerber layer grouping
	type GerberLayerGroup = {
		name: string;
		key: string;
		color: string;
		layers: typeof gerberSummary.layers;
	};
	function gerberLayerGroup(layerKey: string): { name: string; key: string; color: string } {
		if (/^gtl$|^top.*copper|copper.*top/i.test(layerKey) || /^gtl$/i.test(layerKey))
			return { name: 'Copper', key: 'copper', color: '#ef4444' };
		if (/^gbl$/i.test(layerKey)) return { name: 'Copper', key: 'copper', color: '#ef4444' };
		if (/^g(\d+)$/i.test(layerKey)) return { name: 'Copper', key: 'copper', color: '#f59e0b' };
		if (/^gts$|^gbs$/i.test(layerKey))
			return { name: 'Solder Mask', key: 'mask', color: '#a855f7' };
		if (/^gto$|^gbo$/i.test(layerKey)) return { name: 'Silkscreen', key: 'silk', color: '#d97706' };
		if (/^gtp$|^gbp$/i.test(layerKey)) return { name: 'Paste', key: 'paste', color: '#9ca3af' };
		if (/^gm(\d+)$/i.test(layerKey))
			return { name: 'Mechanical', key: 'mechanical', color: '#64748b' };
		if (/^gko$|^gml$|profile|outline/i.test(layerKey))
			return { name: 'Profile', key: 'profile', color: '#84cc16' };
		if (/^drl$|^xln$|drill/i.test(layerKey))
			return { name: 'Drill', key: 'drill', color: '#06b6d4' };
		return { name: 'Other Layers', key: 'other', color: '#6b7280' };
	}
	function gerberLayerColor(layerKey: string, label: string): string {
		if (/^gtl$/i.test(layerKey)) return '#ef4444';
		if (/^gbl$/i.test(layerKey)) return '#1d4ed8';
		const midMatch = /^g(\d+)$/i.exec(layerKey);
		if (midMatch) {
			const palette = ['#ea580c', '#b45309', '#16a34a', '#0891b2', '#8b5cf6', '#db2777'];
			return palette[(parseInt(midMatch[1]) - 1) % palette.length];
		}
		if (/^gts$/i.test(layerKey)) return '#c084fc';
		if (/^gbs$/i.test(layerKey)) return '#f472b6';
		if (/^gto$/i.test(layerKey)) return '#d97706';
		if (/^gbo$/i.test(layerKey)) return '#b45309';
		if (/^gtp$/i.test(layerKey)) return '#9ca3af';
		if (/^gbp$/i.test(layerKey)) return '#78716c';
		if (/^gko$|^gml$/i.test(layerKey) || /profile|outline/i.test(label)) return '#84cc16';
		if (/^drl$|^xln$/i.test(layerKey) || /drill/i.test(label)) return '#06b6d4';
		return '#6b7280';
	}
	const gerberLayerGroups = $derived.by((): GerberLayerGroup[] => {
		const ORDER = ['copper', 'mask', 'silk', 'paste', 'drill', 'mechanical', 'profile', 'other'];
		const map = new Map<string, GerberLayerGroup>();
		for (const layer of gerberSummary.layers) {
			const g = gerberLayerGroup(layer.key);
			if (!map.has(g.key)) map.set(g.key, { name: g.name, key: g.key, color: g.color, layers: [] });
			map.get(g.key)!.layers.push(layer);
		}
		return ORDER.map((k) => map.get(k)).filter((g): g is GerberLayerGroup => !!g);
	});
	function toggleGerberGroup(groupKey: string) {
		const next = new Set(collapsedGerberGroups);
		if (next.has(groupKey)) next.delete(groupKey);
		else next.add(groupKey);
		collapsedGerberGroups = next;
	}
	function toggleGerberLayerVisibility(layerKey: string, e: Event) {
		(e as MouseEvent).stopPropagation();
		const next = new Set(hiddenGerberLayers);
		if (next.has(layerKey)) next.delete(layerKey);
		else next.add(layerKey);
		hiddenGerberLayers = next;
	}
	function isolateGerberLayer(layerKey: string) {
		const all = new Set(gerberSummary.layers.map((l) => l.key));
		all.delete(layerKey);
		hiddenGerberLayers = all;
		selectedKey = layerKey;
	}
	function toggleGerberGroupVisibility(groupKey: string, e: Event) {
		(e as MouseEvent).stopPropagation();
		const groupLayers = gerberLayerGroups.find((g) => g.key === groupKey)?.layers ?? [];
		const allHidden = groupLayers.every((l) => hiddenGerberLayers.has(l.key));
		const next = new Set(hiddenGerberLayers);
		if (allHidden) groupLayers.forEach((l) => next.delete(l.key));
		else groupLayers.forEach((l) => next.add(l.key));
		hiddenGerberLayers = next;
	}
	const gerberSummary = $derived(compareGerberFiles(projectStore.gerberA, projectStore.gerberB));
	const allGerberLayersHidden = $derived(
		gerberSummary.layers.length > 0 &&
			gerberSummary.layers.every((layer) => hiddenGerberLayers.has(layer.key))
	);
	function toggleAllGerberLayers() {
		if (allGerberLayersHidden) {
			hiddenGerberLayers = new Set();
		} else {
			hiddenGerberLayers = new Set(gerberSummary.layers.map((layer) => layer.key));
		}
	}
	const odbSummary = $derived(compareOdbPackages(projectStore.odbA, projectStore.odbB));
	const useOdbDiff = $derived(false);
	const odbLayerDiffByName = $derived.by(
		() => new Map(odbSummary.layers.map((layer) => [layer.name.toLowerCase(), layer]))
	);
	const activeFiles = $derived(files.length > 0 ? files : projectStore.gerberA);
	const visibleGerberFiles = $derived(activeFiles);
	const displayOdbPackages = $derived(
		projectStore.mode === 'compare'
			? []
			: hasUsableOdbPackage(projectStore.odbB)
				? projectStore.odbB
				: odbPackages
	);
	const odbLayers = $derived.by(() =>
		displayOdbPackages.flatMap((odb) =>
			(odb.summary?.layers ?? []).map((layer) => ({
				key: `${odb.name.toLowerCase()}::${layer}`,
				packageName: odb.name,
				layer,
				type: odb.summary?.layerTypes[layer] ?? 'unknown',
				featureCount: odb.summary?.layerFeatureCounts[layer] ?? 0,
				preview: odb.summary?.layerPreviews[layer] ?? null
			}))
		)
	);
	const boardLayerTypes = new Set<OdbLayerType>([
		'copper',
		'mask',
		'paste',
		'silk',
		'outline',
		'drill'
	]);
	function isTopLayerName(name: string) {
		return /(^|[_\-.+\s])(top|front|fcu|f-c|f_cu|l1)($|[_\-.+\s])/.test(name.toLowerCase());
	}
	function isBottomLayerName(name: string) {
		return /(^|[_\-.+\s])(bottom|bot|back|bcu|b-c|b_cu)($|[_\-.+\s])/.test(name.toLowerCase());
	}
	const signalLayerRank = (layer: OdbViewLayer) => {
		const name = layer.layer.toLowerCase();
		if (/(^|[_\-.+])top($|[_\-.+])/.test(name)) return 0;
		if (/(^|[_\-.+])(bottom|bot)($|[_\-.+])/.test(name)) return 90;
		if (layer.type === 'copper') return 30;
		if (layer.type === 'outline') return 100;
		if (layer.type === 'drill') return 110;
		return 120;
	};
	const fullBoardLayers = $derived.by(() =>
		odbLayers
			.filter(
				(layer) =>
					boardLayerTypes.has(layer.type) &&
					layer.preview?.bounds &&
					layer.preview.primitives.length > 0
			)
			.sort(
				(left, right) =>
					signalLayerRank(left) - signalLayerRank(right) ||
					left.layer.localeCompare(right.layer, undefined, { numeric: true })
			)
	);
	const simplifiedBoardLayers = $derived.by(() => {
		const copper = fullBoardLayers.filter((layer) => layer.type === 'copper');
		const top = copper.find((layer) => isTopLayerName(layer.layer)) ?? copper[0] ?? null;
		const bottom =
			copper.find((layer) => isBottomLayerName(layer.layer)) ??
			copper.find((layer) => layer !== top) ??
			null;
		const surfaceLayers = fullBoardLayers.filter(
			(layer) =>
				['mask', 'paste', 'silk', 'drill'].includes(layer.type) &&
				(isTopLayerName(layer.layer) || isBottomLayerName(layer.layer))
		);
		const keep = new Set<OdbViewLayer>(
			[
				...fullBoardLayers.filter((layer) => layer.type === 'outline'),
				top,
				bottom,
				...surfaceLayers
			].filter((layer): layer is OdbViewLayer => !!layer)
		);
		return fullBoardLayers.filter((layer) => keep.has(layer));
	});
	const boardLayers = $derived(viewerStore.minimalUi ? simplifiedBoardLayers : fullBoardLayers);
	const defaultHiddenLayers = $derived.by(
		() =>
			new Set(visibleOdbLayers.filter((layer) => layer.type !== 'copper').map((layer) => layer.key))
	);
	const odbPlacements = $derived.by(() =>
		displayOdbPackages
			.flatMap((odb) => odb.summary?.placements ?? [])
			.filter((placement) => {
				return placement.x !== undefined && placement.y !== undefined;
			})
	);
	const beforeOdbPlacements = $derived.by(() =>
		projectStore.odbA
			.flatMap((odb) => odb.summary?.placements ?? [])
			.filter((placement) => placement.x !== undefined && placement.y !== undefined)
	);
	const componentDiffByName = $derived.by(
		() =>
			new Map(odbSummary.components.map((component) => [component.name.toUpperCase(), component]))
	);
	const componentDiffCounts = $derived.by(() => ({
		added: odbSummary.components.filter((component) => component.status === 'added').length,
		modified: odbSummary.components.filter((component) => component.status === 'modified').length,
		removed: odbSummary.components.filter((component) => component.status === 'removed').length
	}));
	const removedOdbPlacements = $derived.by(() => {
		if (!useOdbDiff) return [];
		return beforeOdbPlacements.filter((placement) => {
			const status = componentDiffByName.get(placement.designator.toUpperCase())?.status;
			return status === 'removed' || status === 'modified';
		});
	});
	const boardBounds = $derived.by(() => {
		const bounds = boardLayers
			.map((layer) => layer.preview?.bounds ?? null)
			.filter((bounds): bounds is OdbBounds => !!bounds)
			.reduce<OdbBounds | null>((current, bounds) => {
				if (!current) return bounds;
				return {
					minX: Math.min(current.minX, bounds.minX),
					minY: Math.min(current.minY, bounds.minY),
					maxX: Math.max(current.maxX, bounds.maxX),
					maxY: Math.max(current.maxY, bounds.maxY)
				};
			}, null);
		if (viewerStore.minimalUi) return bounds;
		return [...odbPlacements, ...removedOdbPlacements].reduce<OdbBounds | null>(
			(current, placement) => {
				if (placement.x === undefined || placement.y === undefined) return current;
				if (!current)
					return {
						minX: placement.x,
						minY: placement.y,
						maxX: placement.x,
						maxY: placement.y
					};
				return {
					minX: Math.min(current.minX, placement.x),
					minY: Math.min(current.minY, placement.y),
					maxX: Math.max(current.maxX, placement.x),
					maxY: Math.max(current.maxY, placement.y)
				};
			},
			bounds
		);
	});
	const selectedFile = $derived.by(() => {
		if (visibleGerberFiles.length === 0 || selectedKey.startsWith('__odb')) return null;
		return (
			visibleGerberFiles.find((file) => file.name.toLowerCase() === selectedKey.toLowerCase()) ??
			visibleGerberFiles[0]
		);
	});
	const selectedGerberDiff = $derived.by(() => {
		if (projectStore.mode !== 'compare' || gerberSummary.layers.length === 0) return null;
		return (
			gerberSummary.layers.find((layer) => layer.key === selectedKey) ??
			gerberSummary.layers[0] ??
			null
		);
	});
	const selectedOdbLayer = $derived(
		visibleOdbLayers.find((layer) => layer.key === selectedOdbLayerKey) ??
			visibleOdbLayers[0] ??
			null
	);
	const selectedOdbLayerDiff = $derived(
		selectedOdbLayer ? (odbLayerDiffByName.get(selectedOdbLayer.layer.toLowerCase()) ?? null) : null
	);
	const selectedLines = $derived(selectedFile ? normalizeGerberLines(selectedFile.text) : []);
	const selectedGeometry = $derived(selectedFile ? parseGerberGeometry(selectedFile.text) : null);
	const selectedGerberBeforeGeometry = $derived(
		selectedGerberDiff?.before ? parseGerberGeometry(selectedGerberDiff.before.text) : null
	);
	const selectedGerberAfterGeometry = $derived(
		selectedGerberDiff?.after ? parseGerberGeometry(selectedGerberDiff.after.text) : null
	);
	const outlineGerberDiff = $derived(
		gerberSummary.layers.find(
			(l) =>
				l.key === 'gko' ||
				l.key === 'gm1' ||
				l.key === 'gml' ||
				l.label.toLowerCase().includes('outline')
		)
	);
	const outlineGerberGeometry = $derived(
		outlineGerberDiff?.after
			? parseGerberGeometry(outlineGerberDiff.after.text)
			: outlineGerberDiff?.before
				? parseGerberGeometry(outlineGerberDiff.before.text)
				: null
	);
	const selectedGerberCompareBounds = $derived(
		mergeGerberBounds(selectedGerberBeforeGeometry, selectedGerberAfterGeometry) ??
			mergeGerberBounds(outlineGerberGeometry)
	);
	const showOutlineGerberReference = $derived(
		!!(
			outlineGerberGeometry?.bounds &&
			selectedGerberCompareBounds &&
			outlineGerberDiff !== selectedGerberDiff &&
			boundsAreCompatible(selectedGerberCompareBounds, outlineGerberGeometry.bounds)
		)
	);

	function gerberViewBox(bounds: GerberBounds) {
		const width = Math.max(1, bounds.maxX - bounds.minX);
		const height = Math.max(1, bounds.maxY - bounds.minY);
		const padding = Math.max(width, height) * 0.04 || 1;
		return `${bounds.minX - padding} ${-bounds.maxY - padding} ${width + padding * 2} ${height + padding * 2}`;
	}

	function mergeGerberBounds(...geometries: Array<GerberGeometry | null>): GerberBounds | null {
		const validBounds = geometries
			.map((candidate) => candidate?.bounds)
			.filter((bounds): bounds is GerberBounds => !!bounds);

		if (validBounds.length === 0) return null;

		return validBounds.reduce((current, candidate) => ({
			minX: Math.min(current.minX, candidate.minX),
			minY: Math.min(current.minY, candidate.minY),
			maxX: Math.max(current.maxX, candidate.maxX),
			maxY: Math.max(current.maxY, candidate.maxY)
		}));
	}

	function boundsAreCompatible(primary: GerberBounds, reference: GerberBounds) {
		const primaryWidth = Math.max(1, primary.maxX - primary.minX);
		const primaryHeight = Math.max(1, primary.maxY - primary.minY);
		const referenceWidth = Math.max(1, reference.maxX - reference.minX);
		const referenceHeight = Math.max(1, reference.maxY - reference.minY);
		const tolerance = Math.max(primaryWidth, primaryHeight, referenceWidth, referenceHeight) * 0.15;
		return !(
			reference.maxX < primary.minX - tolerance ||
			reference.minX > primary.maxX + tolerance ||
			reference.maxY < primary.minY - tolerance ||
			reference.minY > primary.maxY + tolerance
		);
	}

	function odbViewBox(bounds: OdbBounds) {
		const width = Math.max(1, bounds.maxX - bounds.minX);
		const height = Math.max(1, bounds.maxY - bounds.minY);
		const padding = Math.max(width, height) * 0.05 || 1;
		return `${bounds.minX - padding} ${-bounds.maxY - padding} ${width + padding * 2} ${height + padding * 2}`;
	}

	function odbPolygonPoints(preview: OdbLayerPreview, points: Array<{ x: number; y: number }>) {
		const bounds = preview.bounds;
		const width = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) : 1;
		const tolerance = Math.max(width * 0.002, 0.001);
		const closed =
			points.length > 2 &&
			Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < tolerance;
		const rendered = closed ? points : [...points, points[0]];
		return rendered.map((point) => `${point.x},${point.y}`).join(' ');
	}

	function odbPointRadius(preview: OdbLayerPreview) {
		const bounds = preview.bounds;
		if (!bounds) return 0.35;
		return Math.max(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.002, 0.08);
	}

	function odbPreviewClass(type: OdbLayerType) {
		return `odb-preview odb-preview-${type}`;
	}

	function componentSize(bounds: OdbBounds | null) {
		if (!bounds) return { width: 1.4, height: 0.9 };
		const base = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
		return {
			width: Math.max(base * 0.012, 1.1),
			height: Math.max(base * 0.008, 0.7)
		};
	}

	function placementTransform(placement: OdbComponentPlacement, bounds: OdbBounds | null) {
		const size = componentSize(bounds);
		const rotation = placement.rotation ?? 0;
		return `translate(${placement.x ?? 0} ${placement.y ?? 0}) rotate(${rotation}) translate(${-size.width / 2} ${-size.height / 2})`;
	}

	function placementStatus(placement: OdbComponentPlacement) {
		if (!useOdbDiff) return 'unchanged' as OdbDiffStatus;
		return componentDiffByName.get(placement.designator.toUpperCase())?.status ?? 'unchanged';
	}

	function primitiveClass(primitive: OdbLayerVisualPrimitive, status: OdbDiffStatus = 'unchanged') {
		return `odb-primitive odb-primitive-${primitive.kind} ${status}`;
	}

	function signatureCounts(primitives: OdbLayerVisualPrimitive[]) {
		const counts = new Map<string, number>();
		for (const primitive of primitives) {
			const signature = odbPrimitiveSignature(primitive);
			counts.set(signature, (counts.get(signature) ?? 0) + 1);
		}
		return counts;
	}

	function primitiveStatuses(
		before: OdbLayerPreview | null | undefined,
		after: OdbLayerPreview | null | undefined
	) {
		const beforeCounts = signatureCounts(before?.primitives ?? []);
		return (after?.primitives ?? []).map((primitive) => {
			const signature = odbPrimitiveSignature(primitive);
			const remaining = beforeCounts.get(signature) ?? 0;
			if (remaining > 0) {
				beforeCounts.set(signature, remaining - 1);
				return 'unchanged' as OdbDiffStatus;
			}
			return 'added' as OdbDiffStatus;
		});
	}

	function removedPrimitives(
		before: OdbLayerPreview | null | undefined,
		after: OdbLayerPreview | null | undefined
	) {
		const afterCounts = signatureCounts(after?.primitives ?? []);
		return (before?.primitives ?? []).filter((primitive) => {
			const signature = odbPrimitiveSignature(primitive);
			const remaining = afterCounts.get(signature) ?? 0;
			if (remaining > 0) {
				afterCounts.set(signature, remaining - 1);
				return false;
			}
			return true;
		});
	}

	function layerPrimitiveStatus(layer: OdbViewLayer, primitiveIndex: number) {
		if (!useOdbDiff) return 'unchanged' as OdbDiffStatus;
		const diff = odbLayerDiffByName.get(layer.layer.toLowerCase());
		if (!diff) return 'unchanged' as OdbDiffStatus;
		if (diff.status === 'added' || diff.status === 'removed') return diff.status;
		return (
			primitiveStatuses(diff.before?.preview, diff.after?.preview)[primitiveIndex] ?? 'unchanged'
		);
	}

	function layerRemovedPrimitives(layer: OdbViewLayer) {
		if (!useOdbDiff) return [];
		const diff = odbLayerDiffByName.get(layer.layer.toLowerCase());
		if (!diff) return [];
		if (diff.status === 'removed') return diff.before?.preview?.primitives ?? [];
		return removedPrimitives(diff.before?.preview, diff.after?.preview);
	}

	$effect(() => {
		if (projectStore.mode === 'compare') {
			if (gerberSummary.layers.length === 0) selectedKey = '';
			else if (!gerberSummary.layers.some((layer) => layer.key === selectedKey))
				selectedKey = gerberSummary.layers[0].key;
			return;
		}
		if (boardLayers.length > 0 && (!selectedKey || selectedKey === '__odb__'))
			selectedKey = '__odb_board__';
		else if (visibleGerberFiles.length === 0 && !selectedKey.startsWith('__odb')) selectedKey = '';
		else if (selectedKey.startsWith('__odb')) return;
		else if (!selectedKey && selectedFile) selectedKey = selectedFile.name;
	});

	$effect(() => {
		if (visibleOdbLayers.length === 0) selectedOdbLayerKey = '';
		else if (
			!selectedOdbLayerKey ||
			!visibleOdbLayers.some((layer) => layer.key === selectedOdbLayerKey)
		)
			selectedOdbLayerKey = visibleOdbLayers[0].key;
	});

	$effect(() => {
		const visibilityKey = visibleOdbLayers.map((layer) => layer.key).join('|');
		if (!visibilityKey || visibilityKey === appliedOdbDefaultVisibilityKey) return;
		hiddenLayers = new Set(defaultHiddenLayers);
		appliedOdbDefaultVisibilityKey = visibilityKey;
	});
</script>

{#snippet gerberPrimitives(primitives: GerberPrimitive[])}
	{#each primitives as primitive}
		{#if primitive.type === 'draw'}
			<line
				x1={primitive.from.x}
				y1={primitive.from.y}
				x2={primitive.to.x}
				y2={primitive.to.y}
				stroke-width={Math.max(primitive.width, 0.02)}
			/>
		{:else if primitive.shape === 'rectangle'}
			<rect
				x={primitive.at.x - primitive.width / 2}
				y={primitive.at.y - primitive.height / 2}
				width={primitive.width}
				height={primitive.height}
			/>
		{:else if primitive.shape === 'obround'}
			<rect
				x={primitive.at.x - primitive.width / 2}
				y={primitive.at.y - primitive.height / 2}
				width={primitive.width}
				height={primitive.height}
				rx={Math.min(primitive.width, primitive.height) / 2}
				ry={Math.min(primitive.width, primitive.height) / 2}
			/>
		{:else}
			<circle
				cx={primitive.at.x}
				cy={primitive.at.y}
				r={Math.max(primitive.width, primitive.height) / 2}
			/>
		{/if}
	{/each}
{/snippet}

<section class="fabrication-viewer">
	<aside>
		<header>
			<strong>Fabrication</strong>
			<span>Layer browser</span>
		</header>
		{#if boardLayers.length > 0}
			<div class="layer-list board-list">
				<div class="layer-list-header">
					<h3>PCB</h3>
					{#if visibleOdbLayers.length > 0}
						<button
							class="toggle-all-btn"
							onclick={toggleAllOdbLayers}
							title={allOdbLayersHidden ? 'Show all layers' : 'Hide all layers'}
						>
							{#if allOdbLayersHidden}
								<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"
									><path
										d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z"
									/></svg
								>
								Show all
							{:else}
								<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"
									><path
										d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
									/></svg
								>
								Hide all
							{/if}
						</button>
					{/if}
				</div>
				<div
					class="odb-layer-row"
					class:selected={selectedKey === '__odb_board__' &&
						hiddenLayers.size === defaultHiddenLayers.size}
					role="button"
					tabindex="0"
					onclick={() => {
						selectedKey = '__odb_board__';
						hiddenLayers = new Set(defaultHiddenLayers);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							selectedKey = '__odb_board__';
							hiddenLayers = new Set(defaultHiddenLayers);
						}
					}}
				>
					<i
						class="odb-swatch"
						style="background: conic-gradient(#ef4444 0deg 90deg, #a855f7 90deg 180deg, #84cc16 180deg 270deg, #06b6d4 270deg 360deg)"
					></i>
					<span class="odb-layer-name">Board view</span>
					<span class="odb-only-label">{viewerStore.minimalUi ? 'surface' : 'all'}</span>
				</div>
			</div>
		{/if}
		{#if visibleOdbLayers.length > 0}
			<div class="layer-list odb-layer-list">
				<h3>{viewerStore.minimalUi ? 'Signal layers' : 'ODB++ layers'}</h3>
				{#each odbLayerGroups as group}
					{@const groupCollapsed = collapsedOdbGroups.has(group.key)}
					{@const groupAllHidden = group.layers.every((l) => hiddenLayers.has(l.key))}
					<div class="gerber-group">
						<div
							class="gerber-group-header"
							role="button"
							tabindex="0"
							onclick={() => toggleOdbGroup(group.key)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') toggleOdbGroup(group.key);
							}}
						>
							<span class="gerber-group-arrow">{groupCollapsed ? '›' : '‹'}</span>
							<span class="gerber-group-name">{group.name}</span>
							<span
								role="button"
								tabindex="0"
								class="gerber-eye-btn"
								class:hidden={groupAllHidden}
								aria-label="Toggle group visibility"
								onclick={(e) => toggleOdbGroupVisibility(group.key, e)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.stopPropagation();
										toggleOdbGroupVisibility(group.key, e);
									}
								}}
							>
								{#if groupAllHidden}
									<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
										><path
											d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
										/></svg
									>
								{:else}
									<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
										><path
											d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
										/></svg
									>
								{/if}
							</span>
						</div>
						{#if !groupCollapsed}
							{#each group.layers as layer}
								{@const isHidden = hiddenLayers.has(layer.key)}
								{@const isIsolated = !isHidden && hiddenLayers.size === visibleOdbLayers.length - 1}
								{@const isSelected = isIsolated && selectedOdbLayerKey === layer.key}
								<div
									class="odb-layer-row"
									class:selected={isSelected}
									class:hidden-layer={isHidden}
									role="button"
									tabindex="0"
									onclick={() => isolateOdbLayer(layer.key)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') isolateOdbLayer(layer.key);
									}}
								>
									<i class="odb-swatch" style="background: {odbLayerColor(layer)}"></i>
									<span class="odb-layer-name">{layer.layer}</span>
									{#if isIsolated && isSelected}
										<span class="odb-only-label">Only</span>
									{/if}
									<span
										role="button"
										tabindex="0"
										class="gerber-eye-btn"
										class:hidden={isHidden}
										aria-label="Toggle layer visibility"
										onclick={(e) => toggleOdbLayerEye(layer.key, e)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') toggleOdbLayerEye(layer.key, e);
										}}
									>
										{#if isHidden}
											<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
												><path
													d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
												/></svg
											>
										{:else}
											<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
												><path
													d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
												/></svg
											>
										{/if}
									</span>
								</div>
							{/each}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#if projectStore.mode === 'compare'}
			<div class="layer-list gerber-diff-list">
				{#if gerberSummary.layers.length > 0}
					<div class="layer-list-header">
						<h3>Gerber layers</h3>
						<button
							class="toggle-all-btn"
							onclick={toggleAllGerberLayers}
							title={allGerberLayersHidden ? 'Show all layers' : 'Hide all layers'}
						>
							{#if allGerberLayersHidden}
								<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"
									><path
										d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z"
									/></svg
								>
								Show all
							{:else}
								<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"
									><path
										d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
									/></svg
								>
								Hide all
							{/if}
						</button>
					</div>
				{/if}
				{#if gerberSummary.layers.length === 0}
					<p>No Gerber layer loaded for comparison.</p>
				{/if}
				{#each gerberLayerGroups as group}
					{@const groupCollapsed = collapsedGerberGroups.has(group.key)}
					{@const groupAllHidden = group.layers.every((l) => hiddenGerberLayers.has(l.key))}
					<div class="gerber-group">
						<div
							class="gerber-group-header"
							onclick={() => toggleGerberGroup(group.key)}
							role="button"
							tabindex="0"
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') toggleGerberGroup(group.key);
							}}
						>
							<span class="gerber-group-arrow">{groupCollapsed ? '›' : '‹'}</span>
							<span class="gerber-group-name">{group.name}</span>
							<span
								role="button"
								tabindex="0"
								class="gerber-eye-btn"
								class:hidden={groupAllHidden}
								aria-label="Toggle group visibility"
								onclick={(e) => toggleGerberGroupVisibility(group.key, e)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.stopPropagation();
										toggleGerberGroupVisibility(group.key, e);
									}
								}}
							>
								{#if groupAllHidden}
									<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
										><path
											d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
										/></svg
									>
								{:else}
									<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
										><path
											d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
										/></svg
									>
								{/if}
							</span>
						</div>
						{#if !groupCollapsed}
							{#each group.layers as layer}
								{@const isSelected = selectedGerberDiff?.key === layer.key}
								{@const isHidden = hiddenGerberLayers.has(layer.key)}
								{@const isIsolated =
									!hiddenGerberLayers.has(layer.key) &&
									hiddenGerberLayers.size === gerberSummary.layers.length - 1}
								<div
									class="gerber-layer-row"
									class:selected={isSelected}
									class:hidden-layer={isHidden}
									class:is-empty-layer={layer.isEmpty}
									class:diff-added={layer.status === 'added'}
									class:diff-removed={layer.status === 'removed'}
									class:diff-modified={layer.status === 'modified'}
									onclick={() => {
										selectedKey = layer.key;
									}}
									role="button"
									tabindex="0"
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') selectedKey = layer.key;
									}}
								>
									<i
										class="gerber-swatch"
										style="background: {gerberLayerColor(layer.key, layer.label)}"
									></i>
									<span class="gerber-layer-name">{layer.label}</span>
									{#if layer.isEmpty}
										<span class="empty-layer-badge">Vide</span>
									{/if}
									{#if isIsolated && isSelected}
										<span class="gerber-only-label">Only</span>
									{/if}
									<span
										role="button"
										tabindex="0"
										class="gerber-eye-btn"
										class:hidden={isHidden}
										aria-label="Toggle layer visibility"
										onclick={(e) => toggleGerberLayerVisibility(layer.key, e)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ')
												toggleGerberLayerVisibility(layer.key, e);
										}}
										ondblclick={(e) => {
											e.stopPropagation();
											isolateGerberLayer(layer.key);
										}}
									>
										{#if isHidden}
											<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
												><path
													d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
												/></svg
											>
										{:else}
											<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"
												><path
													d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
												/></svg
											>
										{/if}
									</span>
								</div>
							{/each}
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="layer-list" class:advanced-only={viewerStore.minimalUi && boardLayers.length > 0}>
				{#if visibleGerberFiles.length > 0}<h3>Gerber fallback</h3>{/if}
				{#each visibleGerberFiles as file}
					<button
						class:selected={selectedFile?.name === file.name}
						onclick={() => (selectedKey = file.name)}
					>
						<strong>{gerberLayerLabel(file.name)}</strong>
						<span>{file.name}</span>
					</button>
				{/each}
				{#if activeFiles.length > 0 && visibleGerberFiles.length === 0 && boardLayers.length === 0}
					<p>No top, bottom or outline Gerber detected.</p>
				{:else if activeFiles.length === 0 && boardLayers.length === 0}
					<p>No fabrication file loaded.</p>
				{/if}
			</div>
		{/if}
	</aside>

	<div class="gerber-main">
		{#if useOdbDiff}
			<div class="diff-summary odb-diff-summary">
				<span>{odbSummary.counts.unchanged} unchanged</span>
				<span class="added">{odbSummary.counts.added} added</span>
				<span class="modified">{odbSummary.counts.modified} modified</span>
				<span class="removed">{odbSummary.counts.removed} removed</span>
				<span>ODB++ structural diff</span>
			</div>
		{:else if projectStore.mode === 'compare' && (projectStore.gerberA.length > 0 || projectStore.gerberB.length > 0)}
			<div class="diff-summary">
				<span>{gerberSummary.counts.unchanged} unchanged</span>
				<span class="added">{gerberSummary.counts.added} added</span>
				<span class="modified">{gerberSummary.counts.modified} modified</span>
				<span class="removed">{gerberSummary.counts.removed} removed</span>
				<span>Gerber fallback diff</span>
			</div>
		{/if}
		{#if !viewerStore.minimalUi && odbPackages.length > 0}
			<div class="odb-summary">
				<strong>ODB++ package</strong>
				{#each odbPackages as odb}
					{@const summary = odb.summary}
					{#if summary && summary.entryCount > 0}
						<div class="odb-metadata">
							<span>{summary.entryCount} entries</span>
							<span>{summary.steps.length} steps</span>
							<span>{summary.layers.length} layers</span>
							<span>{summary.drillLayers.length} drill layers</span>
							{#if summary.layerTypeCounts.copper > 0}
								<span>{summary.layerTypeCounts.copper} copper</span>
							{/if}
							{#if summary.layerTypeCounts.mask > 0}
								<span>{summary.layerTypeCounts.mask} mask</span>
							{/if}
							{#if summary.layerTypeCounts.paste > 0}
								<span>{summary.layerTypeCounts.paste} paste</span>
							{/if}
							{#if summary.layerTypeCounts.silk > 0}
								<span>{summary.layerTypeCounts.silk} silk</span>
							{/if}
							{#if summary.parsedTextEntryCount > 0}
								<span>{summary.parsedTextEntryCount} parsed files</span>
							{/if}
							<span class:available={summary.hasPlacements}>placements</span>
							<span class:available={summary.hasNets}>nets</span>
						</div>
						{#if summary.layers.length > 0}
							<p>{summary.layers.slice(0, 12).join(', ')}</p>
						{/if}
						{#if summary.components.length > 0 || summary.nets.length > 0}
							<p>
								{summary.components.length} components / {summary.nets.length} nets extracted
							</p>
						{/if}
					{:else if summary?.unsupportedCompression}
						<span>
							Compressed ODB++ intake is tracked, but archive decompression is not available yet.
							Gerber remains available as fallback.
						</span>
					{:else}
						<span>
							ODB++ package is tracked. Layer, drill, placement and net extraction needs an expanded
							package parser for this archive.
						</span>
					{/if}
				{/each}
			</div>
		{/if}
		{#if projectStore.mode === 'compare' && selectedGerberDiff}
			<header class="file-header">
				<div>
					<strong>{selectedGerberDiff.label}</strong>
					<span>
						{selectedGerberDiff.before?.name ?? 'missing A'} / {selectedGerberDiff.after?.name ??
							'missing B'}
					</span>
				</div>
				<b class={`gerber-status ${selectedGerberDiff.status}`}>{selectedGerberDiff.status}</b>
			</header>
			{#if selectedGerberCompareBounds && ((selectedGerberBeforeGeometry?.primitives.length ?? 0) > 0 || (selectedGerberAfterGeometry?.primitives.length ?? 0) > 0)}
				<div class="gerber-preview gerber-compare-preview">
					<SvgPanZoom
						viewBox={gerberViewBox(selectedGerberCompareBounds)}
						ariaLabel="Gerber layer comparison preview"
					>
						<g transform="scale(1 -1)">
							{#if outlineGerberGeometry && showOutlineGerberReference}
								<g class="gerber-outline-reference">
									{@render gerberPrimitives(outlineGerberGeometry.primitives)}
								</g>
							{/if}
							{#if selectedGerberBeforeGeometry}
								<g class="gerber-version version-a">
									{@render gerberPrimitives(selectedGerberBeforeGeometry.primitives)}
								</g>
							{/if}
							{#if selectedGerberAfterGeometry}
								<g class="gerber-version version-b">
									{@render gerberPrimitives(selectedGerberAfterGeometry.primitives)}
								</g>
							{/if}
						</g>
					</SvgPanZoom>
					<div class="preview-status">
						<span>A removed/old</span>
						<span>B added/new</span>
						<span>{selectedGerberDiff.counts.unchanged} common lines</span>
						<span>{selectedGerberDiff.counts.added} added</span>
						<span>{selectedGerberDiff.counts.removed} removed</span>
					</div>
				</div>
			{:else}
				<div class="empty">
					<strong>Couche Gerber vide (aucune géométrie)</strong>
					<span
						>Cette planche/couche Gerber (ex: Bottom paste) ne contient aucun tracé ou flash visuel.
						La comparaison reste accessible via la commande Gerber.</span
					>
				</div>
			{/if}
		{:else if selectedKey === '__odb_board__' && boardBounds}
			<header class="file-header">
				<div>
					<strong>ODB++ PCB</strong>
					<span
						>{viewerStore.minimalUi
							? 'top, bottom, surface layers and outline'
							: 'signals, outline and drill'}</span
					>
				</div>
			</header>
			<div class="odb-layer-details">
				<div class="odb-preview odb-board-preview">
					<SvgPanZoom viewBox={odbViewBox(boardBounds)} ariaLabel="ODB++ board preview">
						<g transform="scale(1 -1)">
							{#each visibleOdbLayers as layer}
								{@const preview = layer.preview}
								{#if preview && !hiddenLayers.has(layer.key)}
									<g
										class={`board-layer board-layer-${layer.type}`}
										style="--layer-color: {odbLayerColor(layer)}"
									>
										{#each preview.primitives as primitive, primitiveIndex}
											{@const primitiveStatus = layerPrimitiveStatus(layer, primitiveIndex)}
											{#if primitive.type === 'line'}
												<line
													class={primitiveClass(primitive, primitiveStatus)}
													x1={primitive.from.x}
													y1={primitive.from.y}
													x2={primitive.to.x}
													y2={primitive.to.y}
												/>
											{:else if primitive.type === 'polygon'}
												<polygon
													class={primitiveClass(primitive, primitiveStatus)}
													points={odbPolygonPoints(preview, primitive.points)}
												/>
											{:else}
												<circle
													class={primitiveClass(primitive, primitiveStatus)}
													cx={primitive.at.x}
													cy={primitive.at.y}
													r={odbPointRadius(preview)}
												/>
											{/if}
										{/each}
										{#each layerRemovedPrimitives(layer) as primitive}
											{#if primitive.type === 'line'}
												<line
													class={primitiveClass(primitive, 'removed')}
													x1={primitive.from.x}
													y1={primitive.from.y}
													x2={primitive.to.x}
													y2={primitive.to.y}
												/>
											{:else if primitive.type === 'polygon'}
												<polygon
													class={primitiveClass(primitive, 'removed')}
													points={odbPolygonPoints(preview, primitive.points)}
												/>
											{:else}
												<circle
													class={primitiveClass(primitive, 'removed')}
													cx={primitive.at.x}
													cy={primitive.at.y}
													r={odbPointRadius(preview)}
												/>
											{/if}
										{/each}
									</g>
								{/if}
							{/each}
							<g class="component-layer">
								{#each removedOdbPlacements as placement}
									{@const size = componentSize(boardBounds)}
									<g
										class="component-placement removed"
										transform={placementTransform(placement, boardBounds)}
									>
										<rect width={size.width} height={size.height} />
										<title>{placement.designator}</title>
									</g>
								{/each}
								{#each odbPlacements as placement}
									{@const size = componentSize(boardBounds)}
									<g
										class={`component-placement ${placementStatus(placement)}`}
										transform={placementTransform(placement, boardBounds)}
									>
										<rect width={size.width} height={size.height} />
										<title>{placement.designator}</title>
									</g>
								{/each}
							</g>
						</g>
					</SvgPanZoom>
					<div class="preview-status">
						<span>board view</span>
						<span
							>{boardLayers.some((layer) => layer.type === 'outline')
								? 'outline'
								: 'no outline'}</span
						>
						<span>{odbPlacements.length} components</span>
					</div>
				</div>
				<footer class="odb-layer-stats">
					<span
						><b>{fullBoardLayers.filter((layer) => layer.type === 'copper').length}</b> signal</span
					>
					<span
						><b>{fullBoardLayers.filter((layer) => layer.type === 'drill').length}</b> drill</span
					>
					<span
						><b>{fullBoardLayers.filter((layer) => layer.type === 'outline').length}</b> outline</span
					>
					{#if useOdbDiff}
						<span class="diff-chip added"><b>{componentDiffCounts.added}</b> comp. added</span>
						<span class="diff-chip modified"
							><b>{componentDiffCounts.modified}</b> comp. changed</span
						>
						<span class="diff-chip removed"><b>{componentDiffCounts.removed}</b> comp. removed</span
						>
					{/if}
				</footer>
			</div>
		{:else if selectedFile}
			<header class="file-header">
				<div>
					<strong>{gerberLayerLabel(selectedFile.name)}</strong>
					<span>{selectedFile.path ?? selectedFile.name}</span>
				</div>
			</header>
			{#if selectedGeometry && selectedGeometry.bounds && selectedGeometry.primitives.length > 0}
				<div class="gerber-preview">
					<SvgPanZoom
						viewBox={gerberViewBox(selectedGeometry.bounds)}
						ariaLabel="Gerber layer preview"
					>
						<g transform="scale(1 -1)">
							{@render gerberPrimitives(selectedGeometry.primitives)}
						</g>
					</SvgPanZoom>
					<div class="preview-status">
						<span>{selectedGeometry.unit.toUpperCase()}</span>
						{#if selectedGeometry.unsupportedCount > 0}
							<span>{selectedGeometry.unsupportedCount} commands skipped</span>
						{/if}
					</div>
				</div>
			{:else}
				<div class="empty">
					<strong>No visual geometry detected</strong>
					<span>The raw Gerber content is still available in Advanced mode.</span>
				</div>
			{/if}
			{#if !viewerStore.minimalUi}
				<pre>{selectedLines.slice(0, 500).join('\n')}</pre>
			{/if}
		{:else if selectedOdbLayer}
			<header class="file-header">
				<div>
					<strong>{selectedOdbLayer.layer}</strong>
					<span>{selectedOdbLayer.packageName} / {selectedOdbLayer.type}</span>
				</div>
			</header>
			<div class="odb-layer-details">
				{#if selectedOdbLayer.preview?.bounds && selectedOdbLayer.preview.primitives.length > 0}
					<div
						class={odbPreviewClass(selectedOdbLayer.type)}
						style="--layer-color: {odbLayerColor(selectedOdbLayer)}"
					>
						<SvgPanZoom
							viewBox={odbViewBox(selectedOdbLayer.preview.bounds)}
							ariaLabel={`ODB++ ${selectedOdbLayer.layer} layer preview`}
						>
							<g transform="scale(1 -1)">
								{#each selectedOdbLayer.preview.primitives as primitive, primitiveIndex}
									{@const primitiveStatus = layerPrimitiveStatus(selectedOdbLayer, primitiveIndex)}
									{#if primitive.type === 'line'}
										<line
											class={primitiveClass(primitive, primitiveStatus)}
											x1={primitive.from.x}
											y1={primitive.from.y}
											x2={primitive.to.x}
											y2={primitive.to.y}
										/>
									{:else if primitive.type === 'polygon'}
										<polygon
											class={primitiveClass(primitive, primitiveStatus)}
											points={odbPolygonPoints(selectedOdbLayer.preview, primitive.points)}
										/>
									{:else}
										<circle
											class={primitiveClass(primitive, primitiveStatus)}
											cx={primitive.at.x}
											cy={primitive.at.y}
											r={odbPointRadius(selectedOdbLayer.preview)}
										/>
									{/if}
								{/each}
								{#each layerRemovedPrimitives(selectedOdbLayer) as primitive}
									{#if primitive.type === 'line'}
										<line
											class={primitiveClass(primitive, 'removed')}
											x1={primitive.from.x}
											y1={primitive.from.y}
											x2={primitive.to.x}
											y2={primitive.to.y}
										/>
									{:else if primitive.type === 'polygon'}
										<polygon
											class={primitiveClass(primitive, 'removed')}
											points={odbPolygonPoints(selectedOdbLayer.preview, primitive.points)}
										/>
									{:else}
										<circle
											class={primitiveClass(primitive, 'removed')}
											cx={primitive.at.x}
											cy={primitive.at.y}
											r={odbPointRadius(selectedOdbLayer.preview)}
										/>
									{/if}
								{/each}
							</g>
						</SvgPanZoom>
						<div class="preview-status">
							<span>{odbLayerTypeLabels[selectedOdbLayer.type]}</span>
							{#if selectedOdbLayer.preview.truncated}
								<span>preview truncated</span>
							{/if}
						</div>
					</div>
				{:else}
					<div class="empty">
						<strong>No visual geometry extracted</strong>
						<span>This layer has feature records, but not enough coordinates for preview yet.</span>
					</div>
				{/if}
				<footer class="odb-layer-stats" class:advanced-only={viewerStore.minimalUi}>
					<span><b>{selectedOdbLayer.featureCount}</b> features</span>
					{#if useOdbDiff && selectedOdbLayerDiff}
						<span class={`diff-chip ${selectedOdbLayerDiff.status}`}>
							<b>{selectedOdbLayerDiff.visualCounts.added}</b> added
						</span>
						<span class={`diff-chip ${selectedOdbLayerDiff.status}`}>
							<b>{selectedOdbLayerDiff.visualCounts.removed}</b> removed
						</span>
						<span class="diff-chip unchanged">
							<b>{selectedOdbLayerDiff.visualCounts.unchanged}</b> common
						</span>
					{/if}
				</footer>
			</div>
		{:else if odbPackages.length > 0}
			<div class="empty">
				<strong>ODB++ package loaded</strong>
				<span
					>The package is tracked, but no layer feature data was extracted from this archive.</span
				>
			</div>
		{:else}
			<div class="empty">
				<strong>Fabrication viewer</strong>
				<span>Drop ODB++, Gerber or drill files with the project export.</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.fabrication-viewer {
		display: grid;
		grid-template-columns: 260px minmax(0, 1fr);
		width: 100%;
		height: 100%;
		min-height: 0;
		background: #f8fafc;
	}

	aside {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-right: 1px solid #dbe2ec;
		background: #ffffff;
	}

	aside header,
	.file-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid #e5e7eb;
		padding: 12px 14px;
	}

	.file-header div {
		min-width: 0;
	}

	aside span,
	.file-header span {
		color: #64748b;
		font-size: 0.76rem;
		overflow-wrap: anywhere;
	}

	.layer-list {
		flex: 1;
		overflow: auto;
		padding: 8px;
	}

	.board-list {
		flex: 0 0 auto;
		border-bottom: 1px solid #eef2f6;
	}

	.odb-layer-list {
		flex: 1 1 auto;
		border-bottom: 1px solid #eef2f6;
	}

	h3 {
		margin: 4px 4px 8px;
		color: #64748b;
		font-size: 0.68rem;
		text-transform: uppercase;
	}

	.layer-list button {
		display: grid;
		gap: 3px;
		width: 100%;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: #111827;
		padding: 8px;
		text-align: left;
	}

	.layer-list button strong {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}

	.layer-swatch {
		flex: 0 0 auto;
		width: 10px;
		height: 10px;
		border: 1px solid rgba(15, 23, 42, 0.18);
		border-radius: 50%;
		background: #64748b;
	}

	.layer-swatch-copper {
		background: #2563eb;
	}

	.layer-swatch-board {
		background: linear-gradient(135deg, #2563eb 0 45%, #0f172a 45% 58%, #16a34a 58%);
	}

	.layer-swatch-mask {
		background: #16a34a;
	}

	.layer-swatch-paste {
		background: #64748b;
	}

	.layer-swatch-silk {
		background: #7c3aed;
	}

	.layer-swatch-drill {
		background: #dc2626;
	}

	.layer-swatch-outline,
	.layer-swatch-mechanical {
		background: #0f172a;
	}

	.layer-swatch-document,
	.layer-swatch-unknown {
		background: #c2410c;
	}

	.layer-list button:hover,
	.layer-list button.selected {
		border-color: #bfdbfe;
		background: #eff6ff;
	}

	.odb-layer-button.added {
		border-color: #86efac;
		background: #f0fdf4;
	}

	.odb-layer-button.modified {
		border-color: #fed7aa;
		background: #fff7ed;
	}

	.odb-layer-button.removed {
		border-color: #fecaca;
		background: #fef2f2;
	}

	.gerber-layer-button.added {
		border-color: #86efac;
		background: #f0fdf4;
	}

	.gerber-layer-button.modified {
		border-color: #fed7aa;
		background: #fff7ed;
	}

	.gerber-layer-button.removed {
		border-color: #fecaca;
		background: #fef2f2;
	}

	.layer-list p,
	.empty {
		color: #64748b;
		font-size: 0.84rem;
	}

	.advanced-only {
		display: none;
	}

	.gerber-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}

	.diff-summary {
		display: flex;
		gap: 8px;
		border-bottom: 1px solid #e5e7eb;
		background: #ffffff;
		padding: 8px 12px;
		color: #64748b;
		font-size: 0.76rem;
		font-weight: 800;
	}

	.diff-summary .added {
		color: #15803d;
	}

	.diff-summary .modified {
		color: #c2410c;
	}

	.diff-summary .removed {
		color: #b91c1c;
	}

	.odb-diff-summary {
		border-bottom-color: #bbf7d0;
		background: #f0fdf4;
	}

	.file-header b {
		color: #475569;
		font-size: 0.76rem;
	}

	.gerber-status {
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: #f8fafc;
		padding: 4px 9px;
		text-transform: uppercase;
	}

	.gerber-status.added {
		border-color: #86efac;
		background: #dcfce7;
		color: #15803d;
	}

	.gerber-status.modified {
		border-color: #fed7aa;
		background: #ffedd5;
		color: #c2410c;
	}

	.gerber-status.removed {
		border-color: #fecaca;
		background: #fee2e2;
		color: #b91c1c;
	}

	.odb-layer-details {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		gap: 0;
		min-height: 0;
		overflow: hidden;
		background:
			linear-gradient(#eef2f6 1px, transparent 1px),
			linear-gradient(90deg, #eef2f6 1px, transparent 1px), #f8fafc;
		background-size: 28px 28px;
	}

	.odb-preview {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	.odb-preview line {
		fill: none;
		stroke: var(--odb-stroke, #1d4ed8);
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 0.12;
	}

	.odb-preview polygon {
		fill: var(--odb-fill, rgba(37, 99, 235, 0.22));
		stroke: var(--odb-stroke, #1d4ed8);
		stroke-linejoin: round;
		stroke-width: 0.12;
	}

	.odb-preview circle {
		fill: var(--odb-stroke, #1d4ed8);
		stroke: #ffffff;
		stroke-width: 0.08;
		vector-effect: non-scaling-stroke;
	}

	.odb-primitive-track,
	.odb-primitive-arc {
		stroke-width: 0.16;
	}

	.odb-primitive-pad {
		fill: rgba(37, 99, 235, 0.32);
	}

	.odb-primitive-drill {
		fill: rgba(220, 38, 38, 0.38);
		stroke: #b91c1c;
	}

	.odb-primitive-outline {
		fill: rgba(15, 23, 42, 0.03);
		stroke: #0f172a;
		stroke-width: 0.22;
	}

	.odb-primitive-surface {
		fill: rgba(37, 99, 235, 0.16);
	}

	.odb-primitive.added {
		fill: rgba(22, 163, 74, 0.34);
		stroke: #16a34a;
	}

	.odb-primitive.removed {
		fill: rgba(220, 38, 38, 0.28);
		stroke: #dc2626;
		stroke-dasharray: 0.7 0.45;
	}

	.odb-board-preview {
		background:
			linear-gradient(#e2e8f0 1px, transparent 1px),
			linear-gradient(90deg, #e2e8f0 1px, transparent 1px), #f8fafc;
		background-size: 24px 24px;
	}

	.board-layer {
		opacity: 0.88;
	}

	.board-layer line {
		fill: none;
		stroke: var(--layer-color, #2563eb);
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 0.18;
		vector-effect: non-scaling-stroke;
	}

	.board-layer polygon {
		fill: var(--layer-color, #2563eb);
		fill-opacity: 0.35;
		stroke: var(--layer-color, #2563eb);
		stroke-linejoin: round;
		stroke-width: 0.12;
		vector-effect: non-scaling-stroke;
	}

	.board-layer circle {
		fill: var(--layer-color, #2563eb);
		fill-opacity: 0.55;
		stroke: var(--layer-color, #2563eb);
		stroke-width: 0.08;
		vector-effect: non-scaling-stroke;
	}

	.board-layer-mask {
		opacity: 0.65;
	}

	.board-layer-paste {
		opacity: 0.75;
	}

	.board-layer-silk {
		opacity: 0.85;
	}

	.board-layer-outline {
		opacity: 1;
	}

	.board-layer-outline line,
	.board-layer-outline polygon,
	.board-layer-outline circle {
		fill: none;
		stroke: var(--layer-color, #84cc16);
		stroke-width: 0.25;
	}

	.empty-layer-badge {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 4px;
		background: #f1f5f9;
		color: #94a3b8;
		margin-left: auto;
		border: 1px solid #e2e8f0;
	}

	.is-empty-layer {
		opacity: 0.55;
	}

	.board-layer-drill line,
	.board-layer-drill polygon,
	.board-layer-drill circle {
		fill: rgba(220, 38, 38, 0.34);
		stroke: #dc2626;
	}

	.component-placement rect {
		fill: rgba(245, 158, 11, 0.45);
		stroke: #92400e;
		stroke-width: 0.08;
		vector-effect: non-scaling-stroke;
	}

	.component-placement.added rect {
		fill: rgba(22, 163, 74, 0.42);
		stroke: #15803d;
	}

	.component-placement.modified rect {
		fill: rgba(245, 158, 11, 0.48);
		stroke: #c2410c;
	}

	.component-placement.removed rect {
		fill: rgba(220, 38, 38, 0.22);
		stroke: #dc2626;
		stroke-dasharray: 0.6 0.42;
	}

	.board-layer .odb-primitive.added {
		fill: rgba(22, 163, 74, 0.34);
		stroke: #16a34a;
	}

	.board-layer .odb-primitive.removed {
		fill: rgba(220, 38, 38, 0.28);
		stroke: #dc2626;
		stroke-dasharray: 0.7 0.45;
	}

	.odb-preview-copper {
		--odb-stroke: #2563eb;
		--odb-fill: rgba(37, 99, 235, 0.24);
	}

	.odb-preview-mask {
		--odb-stroke: #16a34a;
		--odb-fill: rgba(22, 163, 74, 0.22);
	}

	.odb-preview-paste {
		--odb-stroke: #64748b;
		--odb-fill: rgba(100, 116, 139, 0.22);
	}

	.odb-preview-silk {
		--odb-stroke: #7c3aed;
		--odb-fill: rgba(124, 58, 237, 0.18);
	}

	.odb-preview-drill {
		--odb-stroke: #dc2626;
		--odb-fill: rgba(220, 38, 38, 0.18);
	}

	.odb-preview-outline,
	.odb-preview-mechanical {
		--odb-stroke: #0f172a;
		--odb-fill: rgba(15, 23, 42, 0.1);
	}

	.odb-preview-document,
	.odb-preview-unknown {
		--odb-stroke: #c2410c;
		--odb-fill: rgba(194, 65, 12, 0.16);
	}

	.odb-layer-stats {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		border-top: 1px solid #dbe2ec;
		background: rgba(255, 255, 255, 0.94);
		padding: 8px 12px;
	}

	.odb-layer-stats span {
		border: 1px solid #dbe2ec;
		border-radius: 6px;
		background: #ffffff;
		color: #475569;
		padding: 5px 8px;
		font-size: 0.76rem;
		font-weight: 800;
	}

	.odb-layer-stats b {
		color: #1d4ed8;
	}

	.odb-layer-stats .diff-chip.added b {
		color: #15803d;
	}

	.odb-layer-stats .diff-chip.modified b {
		color: #c2410c;
	}

	.odb-layer-stats .diff-chip.removed b {
		color: #b91c1c;
	}

	.odb-layer-stats .diff-chip.unchanged b {
		color: #475569;
	}

	.odb-summary {
		display: grid;
		gap: 8px;
		border-bottom: 1px solid #bfdbfe;
		background: #eff6ff;
		color: #1e3a8a;
		padding: 10px 14px;
	}

	.odb-summary > span,
	.odb-summary p {
		margin: 0;
		color: #475569;
		font-size: 0.78rem;
	}

	.odb-metadata {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.odb-metadata span {
		border: 1px solid #bfdbfe;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.7);
		color: #475569;
		padding: 4px 7px;
		font-size: 0.68rem;
		font-weight: 800;
	}

	.odb-metadata span.available {
		border-color: #86efac;
		background: #dcfce7;
		color: #166534;
	}

	.gerber-preview {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		background:
			linear-gradient(#eef2f6 1px, transparent 1px),
			linear-gradient(90deg, #eef2f6 1px, transparent 1px), #f8fafc;
		background-size: 28px 28px;
	}

	.gerber-preview line,
	.gerber-preview rect,
	.gerber-preview circle {
		fill: #2563eb;
		stroke: #1d4ed8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.gerber-preview line {
		fill: none;
	}

	.gerber-compare-preview .gerber-version {
		mix-blend-mode: multiply;
	}

	.gerber-version.version-a {
		stroke: #f43f5e;
		fill: #f43f5e;
	}

	.gerber-version.version-b {
		stroke: #10b981;
		fill: #10b981;
	}

	.gerber-outline-reference {
		stroke: #cbd5e1;
		fill: #cbd5e1;
		opacity: 0.35;
	}

	.gerber-compare-preview .version-a {
		opacity: 0.54;
	}

	.gerber-compare-preview .version-a line,
	.gerber-compare-preview .version-a rect,
	.gerber-compare-preview .version-a circle {
		fill: #ef4444;
		stroke: #dc2626;
	}

	.gerber-compare-preview .version-a line {
		fill: none;
	}

	.gerber-compare-preview .version-b {
		opacity: 0.58;
	}

	.gerber-compare-preview .version-b line,
	.gerber-compare-preview .version-b rect,
	.gerber-compare-preview .version-b circle {
		fill: #22c55e;
		stroke: #16a34a;
	}

	.gerber-compare-preview .version-b line {
		fill: none;
	}

	.preview-status {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		max-width: calc(100% - 24px);
	}

	.preview-status span {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.9);
		color: #475569;
		padding: 4px 7px;
		font-size: 0.68rem;
		font-weight: 800;
	}

	pre {
		flex: 0 0 min(38%, 260px);
		min-width: 0;
		min-height: 140px;
		margin: 0;
		overflow: auto;
		border-top: 1px solid #1e293b;
		background: #0f172a;
		color: #dbeafe;
		font-size: 0.72rem;
		line-height: 1.45;
		padding: 14px;
	}

	.empty {
		display: grid;
		place-content: center;
		gap: 6px;
		width: 100%;
		height: 100%;
		text-align: center;
	}

	.empty strong {
		color: #111827;
		font-size: 1rem;
	}

	.layer-visibility-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: transparent;
		border: none;
		padding: 0;
		color: #64748b;
		cursor: pointer;
		margin-right: 4px;
		border-radius: 4px;
		transition:
			background-color 0.2s,
			color 0.2s;
	}

	.layer-visibility-toggle:hover {
		background: rgba(0, 0, 0, 0.05);
		color: #334155;
	}

	.layer-visibility-toggle.hidden {
		color: #cbd5e1;
	}

	.layer-list .odb-layer-button {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 6px;
	}

	/* ─── Gerber grouped layer panel ──────────────────── */
	.gerber-group {
		margin-bottom: 2px;
	}

	.gerber-group-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px 5px 8px;
		cursor: pointer;
		user-select: none;
		border-radius: 4px;
		color: #94a3b8;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.gerber-group-header:hover {
		background: rgba(255, 255, 255, 0.04);
		color: #cbd5e1;
	}

	.gerber-group-arrow {
		font-size: 1rem;
		line-height: 1;
		color: #64748b;
		rotate: -90deg;
		display: inline-block;
	}
	:global(.gerber-group-header[aria-expanded='false']) .gerber-group-arrow {
		rotate: 0deg;
	}

	.gerber-group-name {
		flex: 1;
	}

	.gerber-layer-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 10px 5px 24px;
		cursor: pointer;
		border-radius: 4px;
		font-size: 0.8rem;
		color: #cbd5e1;
		user-select: none;
		transition: background 0.1s;
	}
	.gerber-layer-row:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.gerber-layer-row.selected {
		background: rgba(99, 102, 241, 0.18);
		color: #e0e7ff;
		font-weight: 600;
	}
	.gerber-layer-row.hidden-layer {
		opacity: 0.4;
	}

	.gerber-swatch {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.gerber-layer-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.gerber-only-label {
		font-size: 0.7rem;
		color: #94a3b8;
		margin-right: 2px;
	}

	.gerber-eye-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 4px;
		color: #64748b;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.gerber-eye-btn:hover {
		color: #cbd5e1;
		background: rgba(255, 255, 255, 0.08);
	}
	.gerber-eye-btn.hidden {
		color: #334155;
	}

	.gerber-layer-row.diff-added .gerber-layer-name::after {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #10b981;
		margin-left: 5px;
		vertical-align: middle;
	}
	.gerber-layer-row.diff-removed .gerber-layer-name::after {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f43f5e;
		margin-left: 5px;
		vertical-align: middle;
	}
	.gerber-layer-row.diff-modified .gerber-layer-name::after {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f59e0b;
		margin-left: 5px;
		vertical-align: middle;
	}

	/* ─── ODB++ grouped layer panel (mirrors Gerber panel) ─── */
	.odb-layer-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 10px 5px 24px;
		cursor: pointer;
		border-radius: 4px;
		font-size: 0.8rem;
		color: #cbd5e1;
		user-select: none;
		transition: background 0.1s;
	}
	.odb-layer-row:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.odb-layer-row.selected {
		background: rgba(99, 102, 241, 0.18);
		color: #e0e7ff;
		font-weight: 600;
	}
	.odb-layer-row.hidden-layer {
		opacity: 0.4;
	}
	/* board view row has less left indent */
	.board-list .odb-layer-row {
		padding-left: 10px;
	}

	.odb-swatch {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.odb-layer-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.odb-only-label {
		font-size: 0.7rem;
		color: #94a3b8;
		margin-right: 2px;
	}

	.layer-list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 2px 8px 2px;
		margin-bottom: 4px;
	}
	.layer-list-header h3 {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 700;
		color: #cbd5e1;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.toggle-all-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 4px 9px;
		font-size: 0.72rem;
		font-weight: 600;
		color: #e2e8f0;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		flex-shrink: 0;
		line-height: 1;
	}
	.toggle-all-btn:hover {
		background: rgba(99, 102, 241, 0.28);
		border-color: rgba(99, 102, 241, 0.5);
		color: #ffffff;
	}
</style>
