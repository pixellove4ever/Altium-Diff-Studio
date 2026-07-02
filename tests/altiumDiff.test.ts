import assert from 'node:assert/strict';
import test from 'node:test';
import { getBomDiff, getSchematicComponentDiff, getTrackDiff } from '../src/lib/diff/altiumDiff.ts';
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
