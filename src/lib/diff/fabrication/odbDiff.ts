import type {
	OdbComponentPlacement,
	OdbLayerPrimitiveCounts,
	OdbLayerPreview,
	OdbLayerType,
	OdbLayerVisualPrimitive,
	OdbPackageFile,
	OdbPackageSummary
} from '$lib/domain/fabrication/files';

export type OdbDiffStatus = 'unchanged' | 'added' | 'removed' | 'modified';

export interface OdbLayerRecord {
	name: string;
	type: OdbLayerType;
	featureCount: number;
	primitives: OdbLayerPrimitiveCounts;
	preview: OdbLayerPreview | null;
}

export interface OdbLayerDiff {
	name: string;
	before: OdbLayerRecord | null;
	after: OdbLayerRecord | null;
	status: OdbDiffStatus;
	visualCounts: {
		unchanged: number;
		added: number;
		removed: number;
	};
}

export interface OdbNamedDiff {
	name: string;
	status: OdbDiffStatus;
	before?: string;
	after?: string;
}

export interface OdbDiffSummary {
	source: 'odb';
	usable: boolean;
	layers: OdbLayerDiff[];
	components: OdbNamedDiff[];
	nets: OdbNamedDiff[];
	counts: Record<OdbDiffStatus, number>;
}

const emptyPrimitiveCounts = (): OdbLayerPrimitiveCounts => ({
	pads: 0,
	lines: 0,
	arcs: 0,
	surfaces: 0,
	texts: 0,
	other: 0
});

export function hasUsableOdbPackage(packages: OdbPackageFile[]) {
	return packages.some((file) => {
		const summary = file.summary;
		return (
			!!summary &&
			!summary.unsupportedCompression &&
			(summary.layers.length > 0 ||
				summary.components.length > 0 ||
				summary.placements.length > 0 ||
				summary.nets.length > 0)
		);
	});
}

function addPrimitiveCounts(
	left: OdbLayerPrimitiveCounts,
	right: OdbLayerPrimitiveCounts | undefined
) {
	if (!right) return left;
	return {
		pads: left.pads + right.pads,
		lines: left.lines + right.lines,
		arcs: left.arcs + right.arcs,
		surfaces: left.surfaces + right.surfaces,
		texts: left.texts + right.texts,
		other: left.other + right.other
	};
}

function placementSignature(placement: OdbComponentPlacement) {
	const number = (value: number | undefined) =>
		value === undefined ? '' : Number(value.toFixed(4)).toString();
	return [
		placement.designator.toUpperCase(),
		number(placement.x),
		number(placement.y),
		number(placement.rotation),
		placement.side ?? ''
	].join('|');
}

function numberKey(value: number) {
	return Number(value.toFixed(4)).toString();
}

function pointKey(point: { x: number; y: number }) {
	return `${numberKey(point.x)},${numberKey(point.y)}`;
}

export function odbPrimitiveSignature(primitive: OdbLayerVisualPrimitive) {
	if (primitive.type === 'point') return `${primitive.kind}:P:${pointKey(primitive.at)}`;
	if (primitive.type === 'line') {
		const ends = [pointKey(primitive.from), pointKey(primitive.to)].sort();
		return `${primitive.kind}:L:${ends.join('>')}`;
	}
	const points = primitive.points.map(pointKey);
	if (points.length <= 2) return `${primitive.kind}:G:${points.join('>')}`;
	const variants = points.map((_, index) => [...points.slice(index), ...points.slice(0, index)]);
	const reversed = [...points].reverse();
	variants.push(
		...reversed.map((_, index) => [...reversed.slice(index), ...reversed.slice(0, index)])
	);
	return `${primitive.kind}:G:${variants.map((variant) => variant.join('>')).sort()[0]}`;
}

function mergePreview(left: OdbLayerPreview | null, right: OdbLayerPreview | undefined) {
	if (!right) return left;
	if (!left) return right;
	const primitives = [...left.primitives, ...right.primitives];
	const bounds = [left.bounds, right.bounds].reduce<OdbLayerPreview['bounds']>((current, next) => {
		if (!next) return current;
		if (!current) return next;
		return {
			minX: Math.min(current.minX, next.minX),
			minY: Math.min(current.minY, next.minY),
			maxX: Math.max(current.maxX, next.maxX),
			maxY: Math.max(current.maxY, next.maxY)
		};
	}, null);
	return {
		primitives,
		bounds,
		truncated: left.truncated || right.truncated
	};
}

function countPreviewDiff(before: OdbLayerPreview | null, after: OdbLayerPreview | null) {
	const afterBySignature = new Map<string, number>();
	for (const primitive of after?.primitives ?? []) {
		const signature = odbPrimitiveSignature(primitive);
		afterBySignature.set(signature, (afterBySignature.get(signature) ?? 0) + 1);
	}

	let unchanged = 0;
	let removed = 0;
	for (const primitive of before?.primitives ?? []) {
		const signature = odbPrimitiveSignature(primitive);
		const remaining = afterBySignature.get(signature) ?? 0;
		if (remaining > 0) {
			unchanged += 1;
			afterBySignature.set(signature, remaining - 1);
		} else {
			removed += 1;
		}
	}

	let added = 0;
	for (const remaining of afterBySignature.values()) added += remaining;
	return { unchanged, added, removed };
}

function aggregateOdbSummaries(packages: OdbPackageFile[]) {
	const layers = new Map<string, OdbLayerRecord>();
	const components = new Map<string, string>();
	const nets = new Map<string, string>();

	const addComponent = (name: string, signature = name.toUpperCase()) => {
		const key = name.toUpperCase();
		const current = components.get(key);
		components.set(key, current ? [current, signature].sort().join('||') : signature);
	};

	for (const summary of packages
		.map((file) => file.summary)
		.filter((summary): summary is OdbPackageSummary => !!summary)) {
		for (const layer of summary.layers) {
			const current = layers.get(layer);
			const primitives = addPrimitiveCounts(
				current?.primitives ?? emptyPrimitiveCounts(),
				summary.layerPrimitiveCounts[layer]
			);
			layers.set(layer, {
				name: layer,
				type: summary.layerTypes[layer] ?? current?.type ?? 'unknown',
				featureCount: (current?.featureCount ?? 0) + (summary.layerFeatureCounts[layer] ?? 0),
				primitives,
				preview: mergePreview(current?.preview ?? null, summary.layerPreviews[layer])
			});
		}
		for (const component of summary.components) addComponent(component);
		for (const placement of summary.placements)
			addComponent(placement.designator, placementSignature(placement));
		for (const net of summary.nets) nets.set(net.toUpperCase(), net);
	}

	return { layers, components, nets };
}

function recordSignature(record: OdbLayerRecord) {
	const primitives = record.primitives;
	return [
		record.type,
		record.featureCount,
		record.preview?.primitives.length ?? 0,
		primitives.pads,
		primitives.lines,
		primitives.arcs,
		primitives.surfaces,
		primitives.texts,
		primitives.other
	].join('|');
}

function statusFor(before: string | null, after: string | null): OdbDiffStatus {
	if (before === null) return 'added';
	if (after === null) return 'removed';
	return before === after ? 'unchanged' : 'modified';
}

function displayName(value: string | null, key: string) {
	return value?.split('|')[0] || key;
}

function compareNamed(before: Map<string, string>, after: Map<string, string>): OdbNamedDiff[] {
	return Array.from(new Set([...before.keys(), ...after.keys()]))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
		.map((key) => {
			const beforeValue = before.get(key) ?? null;
			const afterValue = after.get(key) ?? null;
			return {
				name: displayName(afterValue ?? beforeValue, key),
				status: statusFor(beforeValue, afterValue),
				before: beforeValue ?? undefined,
				after: afterValue ?? undefined
			};
		});
}

export function compareOdbPackages(
	before: OdbPackageFile[],
	after: OdbPackageFile[]
): OdbDiffSummary {
	const beforeAggregate = aggregateOdbSummaries(before);
	const afterAggregate = aggregateOdbSummaries(after);
	const layers = Array.from(
		new Set([...beforeAggregate.layers.keys(), ...afterAggregate.layers.keys()])
	)
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
		.map((name): OdbLayerDiff => {
			const beforeLayer = beforeAggregate.layers.get(name) ?? null;
			const afterLayer = afterAggregate.layers.get(name) ?? null;
			return {
				name,
				before: beforeLayer,
				after: afterLayer,
				status: statusFor(
					beforeLayer ? recordSignature(beforeLayer) : null,
					afterLayer ? recordSignature(afterLayer) : null
				),
				visualCounts: countPreviewDiff(beforeLayer?.preview ?? null, afterLayer?.preview ?? null)
			};
		});
	const components = compareNamed(beforeAggregate.components, afterAggregate.components);
	const nets = compareNamed(beforeAggregate.nets, afterAggregate.nets);
	const allStatuses = [
		...layers.map((layer) => layer.status),
		...components.map((component) => component.status),
		...nets.map((net) => net.status)
	];
	return {
		source: 'odb',
		usable: hasUsableOdbPackage(before) || hasUsableOdbPackage(after),
		layers,
		components,
		nets,
		counts: {
			unchanged: allStatuses.filter((status) => status === 'unchanged').length,
			added: allStatuses.filter((status) => status === 'added').length,
			removed: allStatuses.filter((status) => status === 'removed').length,
			modified: allStatuses.filter((status) => status === 'modified').length
		}
	};
}
