import type {
	AltiumBomDoc,
	AltiumBomItem,
	AltiumPcbArc,
	AltiumPcbComponent,
	AltiumPcbDoc,
	AltiumPcbPad,
	AltiumPcbPolygon,
	AltiumPcbText,
	AltiumPcbTrack,
	AltiumPcbVia,
	AltiumSchComponent,
	AltiumSchNetLabel,
	AltiumSchWire,
	AltiumSchematicDoc
} from '$lib/types/altium';

export type DiffStatus = 'unchanged' | 'added' | 'removed' | 'modified';

export const diffColors: Record<Exclude<DiffStatus, 'unchanged'> | 'unchanged', string> = {
	unchanged: '#64748b',
	added: '#15803d',
	removed: '#b91c1c',
	modified: '#c2410c'
};

export interface FieldChange {
	field: string;
	from: string;
	to: string;
}

export interface BomDiffRow {
	designator: string;
	status: DiffStatus;
	before: AltiumBomItem | null;
	after: AltiumBomItem | null;
	changes: FieldChange[];
}

export interface ComponentDiff<T> {
	designator: string;
	status: DiffStatus;
	before: T | null;
	after: T | null;
}

export interface PrimitiveDiff<T> {
	status: DiffStatus;
	item: T;
	before: T | null;
	after: T | null;
}

const value = (input: unknown) => (input === undefined || input === null ? '' : String(input));
const numberKey = (input: number) => Number(input || 0).toFixed(3);
const pointKey = (point: { x: number; y: number }) => `${numberKey(point.x)},${numberKey(point.y)}`;

function segmentKey(start: { x: number; y: number }, end: { x: number; y: number }) {
	return [pointKey(start), pointKey(end)].sort().join('>');
}

function polygonGeometryKey(polygon: AltiumPcbPolygon) {
	const vertices = [...polygon.vertices];
	if (vertices.length > 1 && pointKey(vertices[0]) === pointKey(vertices.at(-1)!)) vertices.pop();
	let simplified = vertices;
	let changed = true;
	while (changed && simplified.length > 3) {
		changed = false;
		const next = simplified.filter((point, index, items) => {
			const before = items[(index - 1 + items.length) % items.length];
			const after = items[(index + 1) % items.length];
			const cross =
				(point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x);
			if (Math.abs(cross) > 0.000001) return true;
			changed = true;
			return false;
		});
		simplified = next;
	}
	const points = simplified.map(pointKey);
	if (points.length === 0) return '';
	const minimalRotation = (items: string[]) => {
		const doubled = [...items, ...items];
		let left = 0;
		let right = 1;
		let offset = 0;
		while (left < items.length && right < items.length && offset < items.length) {
			const a = doubled[left + offset];
			const b = doubled[right + offset];
			if (a === b) {
				offset += 1;
				continue;
			}
			if (a > b) left += offset + 1;
			else right += offset + 1;
			if (left === right) right += 1;
			offset = 0;
		}
		const start = Math.min(left, right);
		return [...items.slice(start), ...items.slice(0, start)].join(';');
	};
	return [minimalRotation(points), minimalRotation([...points].reverse())].sort()[0];
}

function addChange(changes: FieldChange[], field: string, from: unknown, to: unknown) {
	if (value(from) !== value(to)) changes.push({ field, from: value(from), to: value(to) });
}

function mapByDesignator<T extends { designator: string }>(items: T[] | undefined) {
	return new Map((items ?? []).map((item) => [item.designator, item]));
}

export function getBomDiff(before: AltiumBomDoc | null, after: AltiumBomDoc | null): BomDiffRow[] {
	const beforeMap = mapByDesignator(before?.items);
	const afterMap = mapByDesignator(after?.items);
	const designators = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort();

	return designators.map((designator) => {
		const beforeItem = beforeMap.get(designator) ?? null;
		const afterItem = afterMap.get(designator) ?? null;

		if (!beforeItem && afterItem) {
			return { designator, status: 'added', before: null, after: afterItem, changes: [] };
		}
		if (beforeItem && !afterItem) {
			return { designator, status: 'removed', before: beforeItem, after: null, changes: [] };
		}

		const changes: FieldChange[] = [];
		addChange(changes, 'Comment', beforeItem?.comment, afterItem?.comment);
		addChange(changes, 'Footprint', beforeItem?.footprint, afterItem?.footprint);
		addChange(changes, 'LibRef', beforeItem?.libRef, afterItem?.libRef);
		addChange(changes, 'Description', beforeItem?.description, afterItem?.description);
		addChange(changes, 'Quantity', beforeItem?.quantity, afterItem?.quantity);

		const parameterKeys = new Set([
			...Object.keys(beforeItem?.parameters ?? {}),
			...Object.keys(afterItem?.parameters ?? {})
		]);

		for (const key of Array.from(parameterKeys).sort()) {
			addChange(changes, key, beforeItem?.parameters?.[key], afterItem?.parameters?.[key]);
		}

		return {
			designator,
			status: changes.length > 0 ? 'modified' : 'unchanged',
			before: beforeItem,
			after: afterItem,
			changes
		};
	});
}

export function getPcbComponentDiff(
	before: AltiumPcbDoc | null,
	after: AltiumPcbDoc | null
): ComponentDiff<AltiumPcbComponent>[] {
	const beforeMap = mapByDesignator(before?.components);
	const afterMap = mapByDesignator(after?.components);
	const designators = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort();

	return designators.map((designator) => {
		const beforeComponent = beforeMap.get(designator) ?? null;
		const afterComponent = afterMap.get(designator) ?? null;
		if (!beforeComponent && afterComponent)
			return { designator, status: 'added', before: null, after: afterComponent };
		if (beforeComponent && !afterComponent)
			return { designator, status: 'removed', before: beforeComponent, after: null };

		const changed =
			beforeComponent?.comment !== afterComponent?.comment ||
			beforeComponent?.footprint !== afterComponent?.footprint ||
			beforeComponent?.layer !== afterComponent?.layer ||
			numberKey(beforeComponent?.rotation ?? 0) !== numberKey(afterComponent?.rotation ?? 0) ||
			numberKey(beforeComponent?.x ?? 0) !== numberKey(afterComponent?.x ?? 0) ||
			numberKey(beforeComponent?.y ?? 0) !== numberKey(afterComponent?.y ?? 0);

		return {
			designator,
			status: changed ? 'modified' : 'unchanged',
			before: beforeComponent,
			after: afterComponent
		};
	});
}

export function getSchematicComponentDiff(
	before: AltiumSchematicDoc | null,
	after: AltiumSchematicDoc | null
): ComponentDiff<AltiumSchComponent>[] {
	const beforeComponents = before?.sheets.flatMap((sheet) => sheet.components) ?? [];
	const afterComponents = after?.sheets.flatMap((sheet) => sheet.components) ?? [];
	const componentKey = (component: AltiumSchComponent) =>
		component.currentPartId === undefined
			? component.designator
			: `${component.designator}#part${component.currentPartId}`;
	const beforeMap = new Map(
		beforeComponents.map((component) => [componentKey(component), component])
	);
	const afterMap = new Map(
		afterComponents.map((component) => [componentKey(component), component])
	);
	const keys = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort();

	return keys.map((key) => {
		const beforeComponent = beforeMap.get(key) ?? null;
		const afterComponent = afterMap.get(key) ?? null;
		const designator = afterComponent?.designator ?? beforeComponent?.designator ?? key;
		if (!beforeComponent && afterComponent)
			return { designator, status: 'added', before: null, after: afterComponent };
		if (beforeComponent && !afterComponent)
			return { designator, status: 'removed', before: beforeComponent, after: null };

		const changed =
			beforeComponent?.comment !== afterComponent?.comment ||
			beforeComponent?.libRef !== afterComponent?.libRef ||
			beforeComponent?.x !== afterComponent?.x ||
			beforeComponent?.y !== afterComponent?.y ||
			JSON.stringify(beforeComponent?.pins ?? []) !== JSON.stringify(afterComponent?.pins ?? []);

		return {
			designator,
			status: changed ? 'modified' : 'unchanged',
			before: beforeComponent,
			after: afterComponent
		};
	});
}

function primitiveDiff<T>(
	before: T[] | undefined,
	after: T[] | undefined,
	key: (item: T) => string,
	signature: (item: T) => string
) {
	const group = (items: T[] | undefined) => {
		const groups = new Map<string, T[]>();
		for (const item of items ?? []) {
			const itemKey = key(item);
			groups.set(itemKey, [...(groups.get(itemKey) ?? []), item]);
		}
		return groups;
	};
	const beforeMap = group(before);
	const afterMap = group(after);
	const result: PrimitiveDiff<T>[] = [];

	for (const itemKey of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
		const bySignature = (items: T[]) => {
			const groups = new Map<string, T[]>();
			for (const item of items) {
				const itemSignature = signature(item);
				groups.set(itemSignature, [...(groups.get(itemSignature) ?? []), item]);
			}
			return groups;
		};
		const beforeBySignature = bySignature(beforeMap.get(itemKey) ?? []);
		const afterBySignature = bySignature(afterMap.get(itemKey) ?? []);
		const beforeItems: T[] = [];
		const afterItems: T[] = [];

		for (const itemSignature of new Set([
			...beforeBySignature.keys(),
			...afterBySignature.keys()
		])) {
			const beforeMatches = beforeBySignature.get(itemSignature) ?? [];
			const afterMatches = afterBySignature.get(itemSignature) ?? [];
			const unchangedCount = Math.min(beforeMatches.length, afterMatches.length);
			for (let index = 0; index < unchangedCount; index += 1) {
				const item = beforeMatches[index];
				const afterItem = afterMatches[index];
				result.push({ status: 'unchanged', item: afterItem, before: item, after: afterItem });
			}
			beforeItems.push(...beforeMatches.slice(unchangedCount));
			afterItems.push(...afterMatches.slice(unchangedCount));
		}

		while (beforeItems.length > 0 && afterItems.length > 0) {
			const item = beforeItems.shift()!;
			const afterItem = afterItems.shift()!;
			result.push({ status: 'modified', item: afterItem, before: item, after: afterItem });
		}
		for (const item of beforeItems)
			result.push({ status: 'removed', item, before: item, after: null });
		for (const item of afterItems)
			result.push({ status: 'added', item, before: null, after: item });
	}

	return result;
}

export function getTrackDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	return primitiveDiff(
		before?.tracks,
		after?.tracks,
		(track: AltiumPcbTrack) => [track.layer, segmentKey(track.start, track.end)].join('|'),
		(track: AltiumPcbTrack) =>
			[
				track.layer,
				segmentKey(track.start, track.end),
				numberKey(track.width),
				value(track.net)
			].join('|')
	);
}

export function getPadDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	return primitiveDiff(
		before?.pads,
		after?.pads,
		(pad: AltiumPcbPad) =>
			[value(pad.component) || `@${pointKey(pad)}`, pad.designator, pad.layer].join('|'),
		(pad: AltiumPcbPad) =>
			[
				pad.layer,
				value(pad.component),
				pad.designator,
				numberKey(pad.x),
				numberKey(pad.y),
				numberKey(pad.size.x),
				numberKey(pad.size.y),
				value(pad.shape),
				numberKey(pad.holeSize),
				value(pad.net)
			].join('|')
	);
}

export function getViaDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	return primitiveDiff(
		before?.vias,
		after?.vias,
		(via: AltiumPcbVia) => [pointKey(via), via.startLayer, via.endLayer].join('|'),
		(via: AltiumPcbVia) =>
			[
				numberKey(via.x),
				numberKey(via.y),
				numberKey(via.diameter),
				numberKey(via.holeSize),
				via.startLayer,
				via.endLayer,
				value(via.net)
			].join('|')
	);
}

export function getPolygonDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	const signature = (polygon: AltiumPcbPolygon) =>
		[polygon.layer, polygonGeometryKey(polygon)].join('|');

	return primitiveDiff(
		before?.polygons,
		after?.polygons,
		(polygon: AltiumPcbPolygon) => polygon.layer,
		signature
	);
}

export function getWireDiff(before: AltiumSchematicDoc | null, after: AltiumSchematicDoc | null) {
	const beforeWires = before?.sheets.flatMap((sheet) => sheet.wires) ?? [];
	const afterWires = after?.sheets.flatMap((sheet) => sheet.wires) ?? [];

	const pointsKey = (wire: AltiumSchWire) => {
		const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
		return points.map((point) => `${numberKey(point.x)},${numberKey(point.y)}`).join(';');
	};

	return primitiveDiff(
		beforeWires,
		afterWires,
		(wire: AltiumSchWire) => wire.id || pointsKey(wire),
		(wire: AltiumSchWire) => `${value(wire.net)}|${pointsKey(wire)}`
	);
}

export function getNetLabelDiff(
	before: AltiumSchematicDoc | null,
	after: AltiumSchematicDoc | null
) {
	const beforeLabels = before?.sheets.flatMap((sheet) => sheet.netLabels) ?? [];
	const afterLabels = after?.sheets.flatMap((sheet) => sheet.netLabels) ?? [];

	return primitiveDiff(
		beforeLabels,
		afterLabels,
		(label: AltiumSchNetLabel) => label.id || value(label.text),
		(label: AltiumSchNetLabel) =>
			[value(label.text), numberKey(label.x), numberKey(label.y)].join('|')
	);
}

export function getArcDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	return primitiveDiff(
		before?.arcs,
		after?.arcs,
		(arc: AltiumPcbArc) =>
			[
				arc.layer,
				numberKey(arc.center.x),
				numberKey(arc.center.y),
				numberKey(arc.radius),
				numberKey(arc.startAngle),
				numberKey(arc.endAngle)
			].join('|'),
		(arc: AltiumPcbArc) =>
			[
				arc.layer,
				numberKey(arc.center.x),
				numberKey(arc.center.y),
				numberKey(arc.radius),
				numberKey(arc.startAngle),
				numberKey(arc.endAngle),
				numberKey(arc.width)
			].join('|')
	);
}

export function getTextDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	return primitiveDiff(
		before?.texts,
		after?.texts,
		(text: AltiumPcbText) =>
			[text.layer, value(text.text), numberKey(text.x), numberKey(text.y)].join('|'),
		(text: AltiumPcbText) =>
			[
				text.layer,
				value(text.text),
				numberKey(text.x),
				numberKey(text.y),
				numberKey(text.height),
				numberKey(text.rotation)
			].join('|')
	);
}

export interface PcbDiffBundle {
	components: ComponentDiff<AltiumPcbComponent>[];
	tracks: PrimitiveDiff<AltiumPcbTrack>[];
	pads: PrimitiveDiff<AltiumPcbPad>[];
	vias: PrimitiveDiff<AltiumPcbVia>[];
	polygons: PrimitiveDiff<AltiumPcbPolygon>[];
	arcs: PrimitiveDiff<AltiumPcbArc>[];
	texts: PrimitiveDiff<AltiumPcbText>[];
}

const pcbDiffCache = new WeakMap<AltiumPcbDoc, WeakMap<AltiumPcbDoc, PcbDiffBundle>>();

export function getPcbDiffBundle(
	before: AltiumPcbDoc | null,
	after: AltiumPcbDoc | null
): PcbDiffBundle {
	if (before && after) {
		const cached = pcbDiffCache.get(before)?.get(after);
		if (cached) return cached;
	}

	const bundle: PcbDiffBundle = {
		components: getPcbComponentDiff(before, after),
		tracks: getTrackDiff(before, after),
		pads: getPadDiff(before, after),
		vias: getViaDiff(before, after),
		polygons: getPolygonDiff(before, after),
		arcs: getArcDiff(before, after),
		texts: getTextDiff(before, after)
	};
	if (before && after) {
		let afterCache = pcbDiffCache.get(before);
		if (!afterCache) {
			afterCache = new WeakMap();
			pcbDiffCache.set(before, afterCache);
		}
		afterCache.set(after, bundle);
	}
	return bundle;
}
