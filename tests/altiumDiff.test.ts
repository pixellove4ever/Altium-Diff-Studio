import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getBomDiff,
	getPcbComponentDiff,
	getSchematicComponentDiff,
	getTrackDiff
} from '../src/lib/diff/altiumDiff.ts';
import type {
	AltiumBomDoc,
	AltiumPcbDoc,
	AltiumSchComponent,
	AltiumSchematicDoc
} from '../src/lib/types/altium.ts';

const bom = (comment: string): AltiumBomDoc => ({
	type: 'bom',
	fileName: 'bom.json',
	fileSize: 1,
	items: [{ designator: 'R1', comment, footprint: '0402', parameters: {} }]
});

const schematicComponent = (value: string, x = 0): AltiumSchComponent => ({
	designator: 'R1',
	comment: value,
	value,
	libRef: 'Resistor',
	x,
	y: 0,
	pins: []
});

const schematic = (component: AltiumSchComponent): AltiumSchematicDoc => ({
	type: 'schematic',
	fileName: 'sheet.json',
	fileSize: 1,
	sheets: [{ components: [component], wires: [], netLabels: [] }]
});

const pcb = (width: number): AltiumPcbDoc => ({
	type: 'pcb',
	fileName: 'pcb.json',
	fileSize: 1,
	components: [],
	tracks: [
		{
			layer: 'Top Layer',
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			width,
			net: 'SDA'
		}
	],
	pads: [],
	vias: [],
	layers: ['Top Layer']
});

test('reports BOM field modifications', () => {
	const diff = getBomDiff(bom('10k'), bom('22k'));
	assert.equal(diff[0].status, 'modified');
	assert.deepEqual(diff[0].changes, [{ field: 'Comment', from: '10k', to: '22k' }]);
});

test('reports schematic value and pin changes', () => {
	const diff = getSchematicComponentDiff(
		schematic(schematicComponent('10k')),
		schematic(schematicComponent('22k'))
	);
	assert.equal(diff[0].status, 'modified');
});

test('reports PCB route geometry modifications', () => {
	const diff = getTrackDiff(pcb(0.2), pcb(0.4));
	assert.equal(diff.length, 1);
	assert.equal(diff[0].status, 'modified');
});

test('ignores unstable primitive IDs and reversed track direction', () => {
	const before = pcb(0.2);
	const after = pcb(0.2);
	before.tracks[0].id = 'generated-1';
	after.tracks[0] = {
		...after.tracks[0],
		id: 'generated-987',
		start: { x: 10, y: 0 },
		end: { x: 0, y: 0 }
	};
	const diff = getTrackDiff(before, after);
	assert.equal(diff.length, 1);
	assert.equal(diff[0].status, 'unchanged');
});

test('keeps duplicate primitives instead of losing them in a map', () => {
	const before = pcb(0.2);
	const after = pcb(0.2);
	before.tracks.push({ ...before.tracks[0], id: 'duplicate-a' });
	after.tracks.push({ ...after.tracks[0], id: 'duplicate-b' });
	const diff = getTrackDiff(before, after);
	assert.equal(diff.length, 2);
	assert.equal(
		diff.every((item) => item.status === 'unchanged'),
		true
	);
});

test('ignores insignificant PCB coordinate rounding', () => {
	const before = pcb(0.2);
	const after = pcb(0.2);
	before.components = [
		{ designator: 'U1', comment: 'MCU', footprint: 'QFN', layer: 'Top Layer', x: 10, y: 20 }
	];
	after.components = [
		{
			...before.components[0],
			x: 10.0004,
			y: 19.9996,
			rotation: 0
		}
	];
	assert.equal(getPcbComponentDiff(before, after)[0].status, 'unchanged');
});
