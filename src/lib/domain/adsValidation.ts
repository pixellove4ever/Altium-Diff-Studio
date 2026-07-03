import type { AltiumDoc, AltiumPoint } from '$lib/types/altium';

export type AdsValidationIssue = {
	severity: 'warning' | 'error';
	path: string;
	message: string;
};

const key = (value: string) => value.trim().toUpperCase();

export function validateAdsDocument(document: AltiumDoc): AdsValidationIssue[] {
	const issues: AdsValidationIssue[] = [];
	const issue = (severity: AdsValidationIssue['severity'], path: string, message: string) =>
		issues.push({ severity, path, message });
	const number = (value: unknown, path: string, nonNegative = false) => {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			issue('error', path, 'Expected a finite JSON number.');
			return;
		}
		if (nonNegative && value < 0) issue('error', path, 'Expected a non-negative dimension.');
		if (Math.abs(value) > 1_000_000)
			issue('warning', path, 'Coordinate exceeds 1 km; verify that units are millimetres.');
	};
	const point = (value: AltiumPoint, path: string) => {
		if (!value || typeof value !== 'object') {
			issue('error', path, 'Expected a coordinate object.');
			return;
		}
		number(value.x, `${path}.x`);
		number(value.y, `${path}.y`);
	};
	const duplicates = (
		values: Array<{ value: unknown; path: string }>,
		label: string,
		severity: AdsValidationIssue['severity'] = 'warning'
	) => {
		const seen = new Map<string, string>();
		for (const entry of values) {
			if (typeof entry.value !== 'string' || !entry.value.trim()) continue;
			const normalized = key(entry.value);
			const previous = seen.get(normalized);
			if (previous)
				issue(severity, entry.path, `Duplicate ${label} "${entry.value}" (first at ${previous}).`);
			else seen.set(normalized, entry.path);
		}
	};

	if (document.type === 'pcb') {
		duplicates(
			document.components.map((component, index) => ({
				value: component.designator,
				path: `components[${index}].designator`
			})),
			'PCB designator',
			'error'
		);
		duplicates(
			(document.nets ?? []).map((net, index) => ({ value: net, path: `nets[${index}]` })),
			'net'
		);
		for (const [index, component] of document.components.entries()) {
			number(component.x, `components[${index}].x`);
			number(component.y, `components[${index}].y`);
			number(component.rotation, `components[${index}].rotation`);
		}
		for (const [index, track] of document.tracks.entries()) {
			point(track.start, `tracks[${index}].start`);
			point(track.end, `tracks[${index}].end`);
			number(track.width, `tracks[${index}].width`, true);
		}
		for (const [index, pad] of document.pads.entries()) {
			number(pad.x, `pads[${index}].x`);
			number(pad.y, `pads[${index}].y`);
			number(pad.size?.x, `pads[${index}].size.x`, true);
			number(pad.size?.y, `pads[${index}].size.y`, true);
			number(pad.holeSize, `pads[${index}].holeSize`, true);
		}
		for (const [index, via] of document.vias.entries()) {
			number(via.x, `vias[${index}].x`);
			number(via.y, `vias[${index}].y`);
			number(via.diameter, `vias[${index}].diameter`, true);
			number(via.holeSize, `vias[${index}].holeSize`, true);
		}
		for (const [index, arc] of (document.arcs ?? []).entries()) {
			point(arc.center, `arcs[${index}].center`);
			number(arc.radius, `arcs[${index}].radius`, true);
			number(arc.width, `arcs[${index}].width`, true);
		}
		for (const [index, polygon] of (document.polygons ?? []).entries())
			polygon.vertices.forEach((vertex, vertexIndex) =>
				point(vertex, `polygons[${index}].vertices[${vertexIndex}]`)
			);
	} else if (document.type === 'schematic') {
		const components = document.sheets.flatMap((sheet, sheetIndex) =>
			sheet.components.map((component, componentIndex) => ({
				component,
				path: `sheets[${sheetIndex}].components[${componentIndex}]`
			}))
		);
		duplicates(
			components.map(({ component, path }) => ({
				value: `${component.designator}#${component.currentPartId ?? 0}`,
				path: `${path}.designator`
			})),
			'schematic designator/part'
		);
		for (const { component, path } of components) {
			number(component.x, `${path}.x`);
			number(component.y, `${path}.y`);
			for (const [pinIndex, pin] of component.pins.entries()) {
				number(pin.x, `${path}.pins[${pinIndex}].x`);
				number(pin.y, `${path}.pins[${pinIndex}].y`);
				number(pin.orientation, `${path}.pins[${pinIndex}].orientation`);
			}
		}
		for (const [sheetIndex, sheet] of document.sheets.entries()) {
			for (const [wireIndex, wire] of sheet.wires.entries()) {
				const points = wire.points ?? [wire.start, wire.end].filter(Boolean);
				if (points.length < 2)
					issue('error', `sheets[${sheetIndex}].wires[${wireIndex}]`, 'A wire needs two points.');
				points.forEach((wirePoint, pointIndex) =>
					point(wirePoint!, `sheets[${sheetIndex}].wires[${wireIndex}].points[${pointIndex}]`)
				);
			}
		}
	} else {
		duplicates(
			document.items.map((item, index) => ({
				value: item.designator,
				path: `items[${index}].designator`
			})),
			'BOM designator'
		);
	}

	const ids: Array<{ value: unknown; path: string }> = [];
	if (document.type === 'pcb') {
		for (const container of [
			'components',
			'tracks',
			'pads',
			'vias',
			'arcs',
			'polygons',
			'texts'
		] as const)
			for (const [index, item] of (document[container] ?? []).entries())
				ids.push({ value: item.id, path: `${container}[${index}].id` });
	} else if (document.type === 'schematic') {
		for (const [sheetIndex, sheet] of document.sheets.entries()) {
			ids.push({ value: sheet.id, path: `sheets[${sheetIndex}].id` });
			for (const [index, component] of sheet.components.entries()) {
				ids.push({ value: component.id, path: `sheets[${sheetIndex}].components[${index}].id` });
				for (const [pinIndex, pin] of component.pins.entries())
					ids.push({
						value: pin.id,
						path: `sheets[${sheetIndex}].components[${index}].pins[${pinIndex}].id`
					});
			}
			for (const container of ['wires', 'netLabels', 'annotations'] as const)
				for (const [index, item] of (sheet[container] ?? []).entries())
					ids.push({ value: item.id, path: `sheets[${sheetIndex}].${container}[${index}].id` });
		}
	}
	duplicates(ids, 'identifier');
	return issues;
}
