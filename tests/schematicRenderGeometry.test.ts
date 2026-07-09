import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLogicalSchematic } from '../src/lib/domain/schematicGraph.ts';
import { prepareSchematicRenderGeometry } from '../src/lib/domain/schematicRenderGeometry.ts';
import type { AltiumSchSheet } from '../src/lib/types/altium.ts';

test('prepares faithful schematic render geometry from native drawing hints', () => {
	const sheet: AltiumSchSheet = {
		name: 'Sheet 1',
		components: [
			{
				designator: 'U1',
				comment: 'MCU',
				libRef: 'STM32',
				currentPartId: 2,
				x: 100,
				y: 100,
				bounds: { x1: 90, y1: 80, x2: 140, y2: 130 },
				symbolGraphics: [
					{ type: 'line', x1: 90, y1: 80, x2: 140, y2: 80 },
					{ type: 'circle', x: 115, y: 105, radius: 30 },
					{ type: 'polyline', points: [{ x: 88, y: 132 }] }
				],
				textRender: [{ type: 'designator', role: 'designator', text: 'U1', x: 92, y: 72 }],
				pins: [{ name: 'IO', num: '1', x: 80, y: 100, orientation: 2 }]
			}
		],
		wires: [
			{
				points: [
					{ x: 0, y: 100 },
					{ x: 80, y: 100 }
				]
			}
		],
		netLabels: [{ text: 'DATA', x: 0, y: 100 }],
		ports: [{ name: 'DATA', x: -20, y: 100 }],
		buses: [
			{
				points: [
					{ x: 0, y: 150 },
					{ x: 200, y: 150 }
				]
			}
		],
		busEntries: [{ name: 'DATA[0]', x: 10, y: 150 }],
		annotations: [
			{
				type: 'textFrame',
				text: 'Note',
				displayText: 'Visible note',
				x: 20,
				y: 20,
				bounds: { x1: 10, y1: 10, x2: 60, y2: 40 }
			}
		]
	};

	const geometry = prepareSchematicRenderGeometry(sheet);

	assert.equal(geometry.hasFaithfulGeometry, true);
	assert.deepEqual(geometry.logicalNodeIds, ['U1#2']);
	assert.ok(geometry.primitives.some((primitive) => primitive.kind === 'symbolGraphic'));
	assert.ok(geometry.primitives.some((primitive) => primitive.kind === 'text'));
	assert.ok(geometry.primitives.some((primitive) => primitive.kind === 'annotation'));
	assert.ok(geometry.primitives.some((primitive) => primitive.kind === 'bus'));
	assert.ok(geometry.primitives.some((primitive) => primitive.kind === 'busEntry'));
	assert.deepEqual(geometry.bounds, { minX: -20, minY: 10, maxX: 200, maxY: 150 });
});

test('keeps schematic render geometry linked to logical graph nodes', () => {
	const sheet: AltiumSchSheet = {
		name: 'Sheet 1',
		components: [
			{
				designator: 'J1',
				comment: 'Connector',
				libRef: 'CONN',
				x: 0,
				y: 0,
				pins: [{ name: 'SIG', num: '1', x: 10, y: 0, orientation: 0 }]
			},
			{
				designator: 'U1',
				comment: 'IC',
				libRef: 'IC',
				currentPartId: 1,
				x: 100,
				y: 0,
				pins: [{ name: 'SIG', num: '1', x: 90, y: 0, orientation: 2 }]
			}
		],
		wires: [
			{
				points: [
					{ x: 10, y: 0 },
					{ x: 90, y: 0 }
				]
			}
		],
		netLabels: [{ text: 'SIG', x: 50, y: 0 }]
	};

	const logical = buildLogicalSchematic(sheet);
	const geometry = prepareSchematicRenderGeometry(sheet);

	assert.deepEqual(new Set(geometry.logicalNodeIds), new Set(logical.nodes.map((node) => node.id)));
	assert.ok(
		geometry.primitives.some(
			(primitive) => primitive.kind === 'component' && primitive.logicalNodeId === 'U1#1'
		)
	);
});
