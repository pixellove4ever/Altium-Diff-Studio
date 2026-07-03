import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { getPcbDiffBundle } from '../src/lib/diff/altiumDiff.ts';
import { getPcbBounds } from '../src/lib/domain/pcbGeometry.ts';
import { getPcbSpatialIndex } from '../src/lib/domain/pcbSpatialIndex.ts';
import type { AltiumPcbDoc } from '../src/lib/types/altium.ts';

type Measurement = {
	primitives: number;
	diffMs: number;
	boundsMs: number;
	spatialBuildMs: number;
	spatialQueriesMs: number;
	diffChanges: number;
};

const limits = {
	10_000: { diffMs: 1500, spatialBuildMs: 1000 },
	50_000: { diffMs: 4000, spatialBuildMs: 2500 },
	100_000: { diffMs: 8000, spatialBuildMs: 5000 }
} as const;

function syntheticPcb(count: number, version: 'A' | 'B'): AltiumPcbDoc {
	const columns = Math.ceil(Math.sqrt(count));
	const tracks: AltiumPcbDoc['tracks'] = Array.from({ length: count }, (_, index) => {
		const x = index % columns;
		const y = Math.floor(index / columns);
		return {
			layer: index % 2 === 0 ? 'Top Layer' : 'Bottom Layer',
			start: { x: x * 2, y: y * 2 },
			end: { x: x * 2 + 1.5, y: y * 2 + (index % 3) * 0.2 },
			width: version === 'B' && index % 997 === 0 ? 0.3 : 0.2,
			net: `NET_${index % 256}`
		};
	});
	const padCount = Math.max(1, Math.floor(count / 10));
	const pads: AltiumPcbDoc['pads'] = Array.from({ length: padCount }, (_, index) => ({
		layer: 'Top Layer',
		designator: String(index + 1),
		component: `U${Math.floor(index / 16) + 1}`,
		x: (index % columns) * 2,
		y: Math.floor(index / columns) * 2,
		size: { x: 0.8, y: 0.8 },
		holeSize: 0,
		shape: 'round',
		net: `NET_${index % 256}`
	}));

	return {
		type: 'pcb',
		fileName: `synthetic-${version}-${count}.json`,
		fileSize: count,
		components: [],
		tracks,
		pads,
		vias: [],
		layers: ['Top Layer', 'Bottom Layer']
	};
}

function elapsed(run: () => void) {
	const start = performance.now();
	run();
	return performance.now() - start;
}

function measure(primitives: keyof typeof limits): Measurement {
	const pcbA = syntheticPcb(primitives, 'A');
	const pcbB = syntheticPcb(primitives, 'B');
	let diffChanges = 0;
	const diffMs = elapsed(() => {
		const bundle = getPcbDiffBundle(pcbA, pcbB);
		diffChanges = bundle.tracks.filter((item) => item.status !== 'unchanged').length;
	});
	const boundsMs = elapsed(() => {
		getPcbBounds(pcbA, pcbB);
	});
	let spatialIndex: ReturnType<typeof getPcbSpatialIndex>;
	const spatialBuildMs = elapsed(() => {
		spatialIndex = getPcbSpatialIndex(pcbB);
	});
	const spatialQueriesMs = elapsed(() => {
		for (let index = 0; index < 1000; index += 1) {
			const x = (index * 17) % 500;
			const y = (index * 31) % 500;
			spatialIndex.tracks.query(x, y, 1);
			spatialIndex.pads.query(x, y, 1);
		}
	});

	return { primitives, diffMs, boundsMs, spatialBuildMs, spatialQueriesMs, diffChanges };
}

const benchmarkSizes = [10_000, 50_000, 100_000] as const;
const measurements = benchmarkSizes.map(measure);

for (const result of measurements) {
	const limit = limits[result.primitives as keyof typeof limits];
	assert.ok(
		result.diffMs < limit.diffMs,
		`${result.primitives} primitive diff took ${result.diffMs.toFixed(1)} ms (limit ${limit.diffMs} ms)`
	);
	assert.ok(
		result.spatialBuildMs < limit.spatialBuildMs,
		`${result.primitives} primitive spatial index took ${result.spatialBuildMs.toFixed(1)} ms (limit ${limit.spatialBuildMs} ms)`
	);
	assert.ok(result.spatialQueriesMs < 1500, '1000 spatial query batches exceeded 1500 ms');
	assert.ok(result.diffChanges > 0, 'Synthetic versions should contain measurable changes');
}

console.table(
	measurements.map((result) => ({
		primitives: result.primitives.toLocaleString('en-US'),
		'diff (ms)': result.diffMs.toFixed(1),
		'bounds (ms)': result.boundsMs.toFixed(1),
		'index (ms)': result.spatialBuildMs.toFixed(1),
		'1000 queries (ms)': result.spatialQueriesMs.toFixed(1),
		changes: result.diffChanges
	}))
);
