import assert from 'node:assert/strict';
import test from 'node:test';
import { SpatialGrid } from '../src/lib/domain/pcbSpatialIndex.ts';

test('finds only spatial entries close to the query', () => {
	const grid = new SpatialGrid(10);
	grid.add(0, { minX: 0, minY: 0, maxX: 4, maxY: 4 });
	grid.add(1, { minX: 100, minY: 100, maxX: 104, maxY: 104 });

	assert.deepEqual(grid.query(2, 2, 1), [0]);
	assert.deepEqual(grid.query(102, 102, 1), [1]);
});

test('returns overlapping entries in reverse drawing order without duplicates', () => {
	const grid = new SpatialGrid(10);
	grid.add(2, { minX: 0, minY: 0, maxX: 25, maxY: 25 });
	grid.add(8, { minX: 5, minY: 5, maxX: 15, maxY: 15 });

	assert.deepEqual(grid.query(10, 10, 12), [8, 2]);
});

test('keeps exceptionally large entries queryable without filling every cell', () => {
	const grid = new SpatialGrid(1);
	grid.add(4, { minX: -10_000, minY: -10_000, maxX: 10_000, maxY: 10_000 });

	assert.deepEqual(grid.query(5000, 5000, 1), [4]);
});
