import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectIndex, searchProject } from '../src/lib/domain/project.ts';
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

test('indexes schematic-only nets from sheet entries and hidden pins', () => {
	const project: AltiumProjectSet = {
		bom: null,
		pcb: null,
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
								{
									num: '8',
									name: 'VCC',
									x: 0,
									y: 0,
									orientation: 0,
									hidden: true,
									hiddenNetName: 'VCC_3V3'
								}
							]
						}
					],
					wires: [],
					netLabels: [],
					sheetEntries: [{ x: 40, y: 0, name: 'REMOTE_IO' }]
				}
			]
		}
	};

	const index = buildProjectIndex(project);
	const component = index.byDesignator.get('U1');

	assert.ok(index.byNet.has('REMOTE_IO'));
	assert.deepEqual(component?.nets, ['VCC_3V3']);
	assert.deepEqual(component?.pinConnections, [{ pinNumber: '8', pinName: 'VCC', net: 'VCC_3V3' }]);
	assert.deepEqual(index.byNet.get('VCC_3V3')?.components, ['U1']);
});

test('indexes schematic-only bus-entry range bits as external nets', () => {
	const project: AltiumProjectSet = {
		bom: null,
		pcb: null,
		schematic: {
			type: 'schematic',
			fileName: 'sheet.json',
			fileSize: 1,
			sheets: [
				{
					components: [],
					wires: [],
					netLabels: [],
					buses: [
						{
							points: [
								{ x: 0, y: 0 },
								{ x: 100, y: 0 }
							]
						}
					],
					busEntries: [{ x: 20, y: 0, name: 'DATA[0..2]' }]
				}
			]
		}
	};

	const index = buildProjectIndex(project);

	assert.ok(index.byNet.has('DATA[0]'));
	assert.ok(index.byNet.has('DATA[1]'));
	assert.ok(index.byNet.has('DATA[2]'));
	assert.equal(index.byNet.has('DATA[0..2]'), false);
});

test('indexes inferred hidden power pin nets in schematic-only projects', () => {
	const project: AltiumProjectSet = {
		bom: null,
		pcb: null,
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
							pins: [{ num: '1', name: 'VCC', x: 0, y: 0, orientation: 0, hidden: true }]
						}
					],
					wires: [],
					netLabels: []
				}
			]
		}
	};

	const index = buildProjectIndex(project);
	const component = index.byDesignator.get('U1');

	assert.deepEqual(component?.nets, ['VCC']);
	assert.deepEqual(component?.pinConnections, [{ pinNumber: '1', pinName: 'VCC', net: 'VCC' }]);
	assert.deepEqual(index.byNet.get('VCC')?.components, ['U1']);
});

test('keeps non-mounted BOM items indexed but marks them hidden from the viewer BOM', () => {
	const project: AltiumProjectSet = {
		pcb: null,
		schematic: null,
		bom: {
			type: 'bom',
			fileName: 'bom.json',
			fileSize: 1,
			items: [
				{ designator: 'R1', comment: '10k', footprint: '0402' },
				{ designator: 'R2', comment: 'DNP', footprint: '0402', parameters: { Fitted: 'False' } },
				{ designator: 'MH1', comment: 'Mounting hole', footprint: 'M3' }
			]
		}
	};

	const index = buildProjectIndex(project);

	assert.deepEqual(
		index.components.map((component) => component.designator),
		['MH1', 'R1', 'R2']
	);
	assert.deepEqual(
		index.components
			.filter((component) => component.visibleInBomViewer)
			.map((component) => component.designator),
		['R1']
	);
	assert.equal(index.byDesignator.get('R2')?.bomViewerHiddenReason, 'Not mounted');
	assert.equal(index.byDesignator.get('MH1')?.bomViewerHiddenReason, 'Mechanical');
	assert.ok(index.byDesignator.has('R2'));
	assert.ok(index.byDesignator.has('MH1'));
});

test('hides repeated-channel schematic templates when concrete PCB instances exist', () => {
	const project: AltiumProjectSet = {
		schematic: {
			type: 'schematic',
			fileName: 'generic-channel.json',
			fileSize: 1,
			sheets: [
				{
					components: [
						{
							designator: 'C323',
							comment: 'Capacitor 0805',
							libRef: 'CAP',
							x: 0,
							y: 0,
							pins: []
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
			layers: ['Top Layer'],
			nets: [],
			components: [
				{
					designator: 'C323_FR0',
					baseDesignator: 'C323',
					comment: 'Capacitor 0805',
					footprint: '0805',
					layer: 'Top Layer',
					x: 0,
					y: 0,
					rotation: 0
				}
			],
			pads: [],
			tracks: [],
			vias: []
		},
		bom: null
	};

	const index = buildProjectIndex(project);

	assert.deepEqual(
		index.components.map((component) => component.designator),
		['C323', 'C323_FR0']
	);
	assert.deepEqual(
		index.components
			.filter((component) => component.visibleInBomViewer)
			.map((component) => component.designator),
		['C323_FR0']
	);
	assert.equal(index.byDesignator.get('C323')?.bomViewerHiddenReason, 'Template');
	assert.ok(index.byDesignator.get('C323_FR0')?.schematic);
});

test('merges schematic and BOM parameters for project search and inspection metadata', () => {
	const project: AltiumProjectSet = {
		pcb: null,
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
							pins: [],
							parameters: {
								Manufacturer: 'SchematicCo',
								MPN: 'SCH-ONLY-123',
								Voltage: '3V3'
							}
						}
					],
					wires: [],
					netLabels: []
				}
			]
		},
		bom: {
			type: 'bom',
			fileName: 'bom.json',
			fileSize: 1,
			items: [
				{
					designator: 'U1',
					comment: 'MCU',
					footprint: 'QFN',
					parameters: {
						Manufacturer: 'BomCo'
					}
				}
			]
		}
	};

	const index = buildProjectIndex(project);
	const component = index.byDesignator.get('U1');

	assert.deepEqual(component?.parameters, {
		Manufacturer: 'BomCo',
		MPN: 'SCH-ONLY-123',
		Voltage: '3V3'
	});
	assert.deepEqual(
		searchProject(index, 'SCH-ONLY-123').map((match) => match.designator),
		['U1']
	);
});
