import type { AltiumPcbDoc } from '$lib/types/altium';

type SpatialBounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
};

export class SpatialGrid {
	private readonly cells = new Map<string, number[]>();
	private readonly globalIndices = new Set<number>();
	private readonly cellSize: number;

	constructor(cellSize = 12) {
		this.cellSize = cellSize;
	}

	private cell(value: number) {
		return Math.floor(value / this.cellSize);
	}

	private key(x: number, y: number) {
		return `${x}:${y}`;
	}

	add(index: number, bounds: SpatialBounds) {
		const minCellX = this.cell(bounds.minX);
		const maxCellX = this.cell(bounds.maxX);
		const minCellY = this.cell(bounds.minY);
		const maxCellY = this.cell(bounds.maxY);
		if ((maxCellX - minCellX + 1) * (maxCellY - minCellY + 1) > 4096) {
			this.globalIndices.add(index);
			return;
		}
		for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
			for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
				const key = this.key(cellX, cellY);
				const values = this.cells.get(key);
				if (values) values.push(index);
				else this.cells.set(key, [index]);
			}
		}
	}

	query(x: number, y: number, radius: number) {
		const indices = new Set(this.globalIndices);
		const minCellX = this.cell(x - radius);
		const maxCellX = this.cell(x + radius);
		const minCellY = this.cell(y - radius);
		const maxCellY = this.cell(y + radius);
		for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
			for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
				for (const index of this.cells.get(this.key(cellX, cellY)) ?? []) indices.add(index);
			}
		}
		return Array.from(indices).sort((a, b) => b - a);
	}
}

export type PcbSpatialIndex = {
	pads: SpatialGrid;
	tracks: SpatialGrid;
	components: SpatialGrid;
};

const pcbSpatialCache = new WeakMap<AltiumPcbDoc, PcbSpatialIndex>();

export function getPcbSpatialIndex(pcb: AltiumPcbDoc): PcbSpatialIndex {
	const cached = pcbSpatialCache.get(pcb);
	if (cached) return cached;

	const index: PcbSpatialIndex = {
		pads: new SpatialGrid(),
		tracks: new SpatialGrid(),
		components: new SpatialGrid()
	};
	pcb.pads.forEach((pad, itemIndex) => {
		index.pads.add(itemIndex, {
			minX: pad.x - pad.size.x / 2,
			minY: pad.y - pad.size.y / 2,
			maxX: pad.x + pad.size.x / 2,
			maxY: pad.y + pad.size.y / 2
		});
	});
	pcb.tracks.forEach((track, itemIndex) => {
		const margin = track.width / 2;
		index.tracks.add(itemIndex, {
			minX: Math.min(track.start.x, track.end.x) - margin,
			minY: Math.min(track.start.y, track.end.y) - margin,
			maxX: Math.max(track.start.x, track.end.x) + margin,
			maxY: Math.max(track.start.y, track.end.y) + margin
		});
	});
	pcb.components.forEach((component, itemIndex) => {
		const bounds = component.bounds ?? {
			x1: component.x - 3,
			y1: component.y - 3,
			x2: component.x + 3,
			y2: component.y + 3
		};
		index.components.add(itemIndex, {
			minX: Math.min(bounds.x1, bounds.x2),
			minY: Math.min(bounds.y1, bounds.y2),
			maxX: Math.max(bounds.x1, bounds.x2),
			maxY: Math.max(bounds.y1, bounds.y2)
		});
	});

	pcbSpatialCache.set(pcb, index);
	return index;
}
