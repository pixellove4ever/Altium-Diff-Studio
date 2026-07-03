import type { AltiumPcbDoc } from '../types/altium.ts';

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function includeBounds(bounds: Bounds, x: number, y: number) {
	bounds.minX = Math.min(bounds.minX, x);
	bounds.minY = Math.min(bounds.minY, y);
	bounds.maxX = Math.max(bounds.maxX, x);
	bounds.maxY = Math.max(bounds.maxY, y);
}

const pcbBoundsCache = new WeakMap<AltiumPcbDoc, Bounds>();

function getSinglePcbBounds(pcb: AltiumPcbDoc): Bounds {
	const cached = pcbBoundsCache.get(pcb);
	if (cached) return cached;
	const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

	const outlineBounds = pcb.boardOutlineRenderBounds;
	if (
		outlineBounds &&
		Number.isFinite(outlineBounds.minX) &&
		Number.isFinite(outlineBounds.minY) &&
		Number.isFinite(outlineBounds.maxX) &&
		Number.isFinite(outlineBounds.maxY) &&
		outlineBounds.maxX > outlineBounds.minX &&
		outlineBounds.maxY > outlineBounds.minY
	) {
		includeBounds(bounds, outlineBounds.minX, outlineBounds.minY);
		includeBounds(bounds, outlineBounds.maxX, outlineBounds.maxY);
	} else {
		for (const track of pcb.tracks) {
			includeBounds(bounds, track.start.x, track.start.y);
			includeBounds(bounds, track.end.x, track.end.y);
		}
		pcb.boardOutline?.forEach((point) => includeBounds(bounds, point.x, point.y));
		pcb.boardOutlineEdges?.forEach((edge) => {
			if (edge.edgeClass !== 'boardOutlineCandidate') return;
			includeBounds(bounds, edge.start.x, edge.start.y);
			includeBounds(bounds, edge.end.x, edge.end.y);
		});
		pcb.polygons?.forEach((polygon) =>
			polygon.vertices.forEach((point) => includeBounds(bounds, point.x, point.y))
		);
		for (const pad of pcb.pads) includeBounds(bounds, pad.x, pad.y);
		for (const via of pcb.vias) includeBounds(bounds, via.x, via.y);
		for (const component of pcb.components) includeBounds(bounds, component.x, component.y);
		pcb.arcs?.forEach((arc) => {
			includeBounds(bounds, arc.center.x - arc.radius, arc.center.y - arc.radius);
			includeBounds(bounds, arc.center.x + arc.radius, arc.center.y + arc.radius);
		});
		pcb.texts?.forEach((text) => includeBounds(bounds, text.x, text.y));
	}

	if (!Number.isFinite(bounds.minX)) {
		const fallback = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
		pcbBoundsCache.set(pcb, fallback);
		return fallback;
	}
	pcbBoundsCache.set(pcb, bounds);
	return bounds;
}

export function getPcbBounds(...pcbs: Array<AltiumPcbDoc | null>): Bounds {
	const available = pcbs.filter((pcb): pcb is AltiumPcbDoc => pcb !== null);
	if (available.length === 0) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
	if (available.length === 1) return getSinglePcbBounds(available[0]);

	const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const pcb of available) {
		const current = getSinglePcbBounds(pcb);
		includeBounds(bounds, current.minX, current.minY);
		includeBounds(bounds, current.maxX, current.maxY);
	}
	return bounds;
}
