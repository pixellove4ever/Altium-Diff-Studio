import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDxfPrimitives, type DxfPrimitive } from '../src/lib/diff/dxfDiff.ts';

const line = (points: Array<[number, number]>, closed = false): DxfPrimitive => ({
	type: 'line',
	points: points.map(([x, y]) => ({ x, y })),
	closed
});

test('matches open DXF lines regardless of their direction', () => {
	const before = line([
		[0, 0],
		[10, 5]
	]);
	const after = line([
		[10, 5],
		[0, 0]
	]);

	assert.deepEqual(compareDxfPrimitives([before], [after]).counts, {
		unchanged: 1,
		added: 0,
		removed: 0,
		modified: 0
	});
});

test('matches closed DXF polylines regardless of start vertex and direction', () => {
	const before = line(
		[
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		],
		true
	);
	const after = line(
		[
			[10, 10],
			[10, 0],
			[0, 0],
			[0, 10]
		],
		true
	);

	assert.equal(compareDxfPrimitives([before], [after]).counts.unchanged, 1);
});

test('ignores insignificant DXF coordinate rounding', () => {
	const before: DxfPrimitive = { type: 'circle', center: { x: 5, y: 6 }, radius: 2 };
	const after: DxfPrimitive = {
		type: 'circle',
		center: { x: 5.003, y: 5.997 },
		radius: 2.004
	};

	assert.equal(compareDxfPrimitives([before], [after]).counts.unchanged, 1);
});

test('preserves duplicate DXF primitives and reports real additions', () => {
	const primitive = line([
		[0, 0],
		[2, 0]
	]);
	const added = line([
		[0, 1],
		[2, 1]
	]);
	const diff = compareDxfPrimitives([primitive, primitive], [primitive, primitive, added]);

	assert.deepEqual(diff.counts, { unchanged: 2, added: 1, removed: 0, modified: 0 });
	assert.deepEqual(diff.after, ['unchanged', 'unchanged', 'added']);
});

test('normalizes whitespace in DXF text while retaining semantic changes', () => {
	const base = {
		type: 'text' as const,
		point: { x: 0, y: 0 },
		height: 2,
		rotation: 0
	};
	const common = compareDxfPrimitives(
		[{ ...base, text: 'R1   10k' }],
		[{ ...base, text: 'R1 10k' }]
	);
	const changed = compareDxfPrimitives([{ ...base, text: '10k' }], [{ ...base, text: '22k' }]);

	assert.equal(common.counts.unchanged, 1);
	assert.deepEqual(changed.counts, { unchanged: 0, added: 0, removed: 0, modified: 1 });
	assert.deepEqual(changed.before, ['modified']);
	assert.deepEqual(changed.after, ['modified']);
});
