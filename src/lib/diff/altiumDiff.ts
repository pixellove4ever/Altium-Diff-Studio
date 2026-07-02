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
	unchanged: '#94a3b8',
	added: '#16a34a',
	removed: '#dc2626',
	modified: '#f97316'
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
			beforeComponent?.rotation !== afterComponent?.rotation ||
			beforeComponent?.x !== afterComponent?.x ||
			beforeComponent?.y !== afterComponent?.y;

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
	const beforeMap = new Map((before ?? []).map((item) => [key(item), item]));
	const afterMap = new Map((after ?? []).map((item) => [key(item), item]));
	const result: PrimitiveDiff<T>[] = [];

	for (const [key, item] of beforeMap) {
		const afterItem = afterMap.get(key);
		if (!afterItem) {
			result.push({ status: 'removed', item, before: item, after: null });
		} else {
			const status = signature(item) === signature(afterItem) ? 'unchanged' : 'modified';
			result.push({ status, item: afterItem, before: item, after: afterItem });
		}
	}
	for (const [key, item] of afterMap) {
		if (!beforeMap.has(key)) result.push({ status: 'added', item, before: null, after: item });
	}

	return result;
}

export function getTrackDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	return primitiveDiff(
		before?.tracks,
		after?.tracks,
		(track: AltiumPcbTrack) =>
			track.id ||
			[
				track.layer,
				numberKey(track.start.x),
				numberKey(track.start.y),
				numberKey(track.end.x),
				numberKey(track.end.y)
			].join('|'),
		(track: AltiumPcbTrack) =>
			[
				track.layer,
				numberKey(track.start.x),
				numberKey(track.start.y),
				numberKey(track.end.x),
				numberKey(track.end.y),
				numberKey(track.width),
				value(track.net)
			].join('|')
	);
}

export function getPadDiff(before: AltiumPcbDoc | null, after: AltiumPcbDoc | null) {
	return primitiveDiff(
		before?.pads,
		after?.pads,
		(pad: AltiumPcbPad) => pad.id || [value(pad.component), pad.designator, pad.layer].join('|'),
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
		(via: AltiumPcbVia) =>
			via.id || [numberKey(via.x), numberKey(via.y), via.startLayer, via.endLayer].join('|'),
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
		[
			polygon.layer,
			value(polygon.net),
			polygon.vertices.map((point) => `${numberKey(point.x)},${numberKey(point.y)}`).join(';')
		].join('|');

	return primitiveDiff(
		before?.polygons,
		after?.polygons,
		(polygon: AltiumPcbPolygon) => polygon.id || signature(polygon),
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
			arc.id ||
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
			text.id || [text.layer, value(text.text), numberKey(text.x), numberKey(text.y)].join('|'),
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
