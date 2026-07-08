import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectIndex } from '../src/lib/domain/project.ts';
import type { AltiumProjectSet } from '../src/lib/types/altium.ts';

test('builds component pin connections from indexed PCB pads', () => {
	const project: AltiumProjectSet = {
		bom: null,
		schematic: {
			type: 'schematic',
			fileName: 'sheet.json',
			fileSize: 1,
			sheets: [
				{
					components: [
						{
							designator: 'U1',
							comment: 'MCU',
							libRef: 'MCU',
							x: 0,
							y: 0,
							pins: [
								{ num: '1', name: 'VCC', x: 0, y: 0, orientation: 0 },
								{ num: '2', name: 'IO', x: 10, y: 0, orientation: 180 }
							]
						}
					],
					wires: [],
					netLabels: []
				}
			]
		},
		pcb: {
			type: 'pcb',
			fileName: 'pcb.json',
			fileSize: 1,
			components: [
				{
					designator: 'U1',
					comment: 'MCU',
					footprint: 'QFN',
					layer: 'Top Layer',
					x: 0,
					y: 0,
					rotation: 0
				}
			],
			tracks: [],
			pads: [
				{
					component: ' u1 ',
					designator: '1',
					x: 0,
					y: 0,
					size: { x: 1, y: 1 },
					shape: 'rectangular',
					holeSize: 0,
					layer: 'Top Layer',
					net: 'VCC'
				},
				{
					component: 'U1',
					designator: '2',
					x: 1,
					y: 0,
					size: { x: 1, y: 1 },
					shape: 'rectangular',
					holeSize: 0,
					layer: 'Top Layer',
					net: 'IO'
				}
			],
			vias: [],
			layers: ['Top Layer']
		}
	};

	const component = buildProjectIndex(project).byDesignator.get('U1');

	assert.deepEqual(component?.nets, ['IO', 'VCC']);
	assert.deepEqual(
		component?.pinConnections.map((connection) => ({
			pinNumber: connection.pinNumber,
			pinName: connection.pinName,
			net: connection.net
		})),
		[
			{ pinNumber: '1', pinName: 'VCC', net: 'VCC' },
			{ pinNumber: '2', pinName: 'IO', net: 'IO' }
		]
	);
});
