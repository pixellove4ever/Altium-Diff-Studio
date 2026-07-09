import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildLogicalSchematic,
	isPowerNet,
	resolveUniquePinNet
} from '../src/lib/domain/schematicGraph.ts';
import type { AltiumSchComponent, AltiumSchPin, AltiumSchSheet } from '../src/lib/types/altium.ts';

function pin(name: string, num: string, x: number, y: number): AltiumSchPin {
	return { name, num, x, y, orientation: 0, length: 10 };
}

function component(
	designator: string,
	pins: AltiumSchPin[] = [],
	value = designator
): AltiumSchComponent {
	return {
		designator,
		comment: value,
		libRef: value,
		value,
		x: 0,
		y: 0,
		pins
	};
}

function sheet(overrides: Partial<AltiumSchSheet>): AltiumSchSheet {
	return {
		components: [],
		wires: [],
		netLabels: [],
		ports: [],
		powerPorts: [],
		...overrides
	};
}

test('recognizes common power and ground rail names', () => {
	for (const name of ['GND', 'DGND', 'VSS', 'VCC', 'VDD_3V3', '+12V', '5V_USB', 'VIN']) {
		assert.equal(isPowerNet(name), true, name);
	}
	for (const name of ['GPIO5', 'CLOCK', 'RESET_N', 'SDA', '+IN', '-IN', '+SHDN']) {
		assert.equal(isPowerNet(name), false, name);
	}
});

test('classifies component families from their designators', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [
				component('R1'),
				component('C1'),
				component('L1'),
				component('D1'),
				component('J1'),
				component('U1'),
				component('Q1'),
				component('F1'),
				component('Y1'),
				component('SW1')
			]
		})
	);
	const kinds = new Map(logical.nodes.map((node) => [node.label, node.kind]));
	assert.equal(kinds.get('R1'), 'resistor');
	assert.equal(kinds.get('C1'), 'capacitor');
	assert.equal(kinds.get('L1'), 'inductor');
	assert.equal(kinds.get('D1'), 'diode');
	assert.equal(kinds.get('J1'), 'connector');
	assert.equal(kinds.get('U1'), 'ic');
	assert.equal(kinds.get('Q1'), 'transistor');
	assert.equal(kinds.get('F1'), 'protection');
	assert.equal(kinds.get('Y1'), 'oscillator');
	assert.equal(kinds.get('SW1'), 'switch');
});

test('keeps power inside the node and signals on external ports', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [component('U1', [pin('VSS', '1', 0, 0), pin('OUT', '2', 0, 20)])],
			wires: [
				{
					points: [
						{ x: 10, y: 0 },
						{ x: 30, y: 0 }
					]
				}
			],
			powerPorts: [{ x: 30, y: 0, text: 'GND' }],
			netLabels: [{ x: 10, y: 20, text: 'GPIO_OUT' }]
		})
	);
	const node = logical.nodes[0];
	assert.deepEqual(
		node.powerPorts.map((port) => port.netName),
		['GND']
	);
	assert.deepEqual(
		node.ports.map((port) => port.netName),
		['GPIO_OUT']
	);
	assert.equal(
		logical.nets.some((net) => net.name === 'GND'),
		false
	);
});

test('folds testpoints into the connected signal metadata', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [
				component('R1', [pin('SIG', '1', 0, 0)]),
				component('TP1', [pin('TP', '1', 20, 0)])
			],
			wires: [
				{
					points: [
						{ x: 10, y: 0 },
						{ x: 30, y: 0 }
					]
				}
			],
			netLabels: [{ x: 20, y: 0, text: 'SENSE' }]
		})
	);
	assert.equal(
		logical.nodes.some((node) => node.label === 'TP1'),
		false
	);
	const sense = logical.nets.find((net) => net.name === 'SENSE');
	assert.ok(sense);
	assert.deepEqual(sense.testpoints, ['TP1']);
});

test('resolves labels placed on long wire segments through the segment index', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [component('U1', [pin('IO', '1', 0, 0)])],
			wires: [
				{
					points: [
						{ x: 10, y: 0 },
						{ x: 2010, y: 0 }
					]
				}
			],
			netLabels: [{ x: 1110, y: 0, text: 'LONG_NET' }]
		})
	);

	assert.deepEqual(
		logical.nodes[0].ports.map((port) => port.netName),
		['LONG_NET']
	);
});

test('keeps common and active pins on multi-part components', () => {
	const multiPart = component('U1', [
		{ ...pin('COM', '1', 0, 0), ownerPartId: 0 },
		{ ...pin('A', '2', 0, 20), ownerPartId: 1 },
		{ ...pin('B', '3', 0, 40), ownerPartId: 2 }
	]);
	multiPart.currentPartId = 1;
	multiPart.partCount = 2;
	const logical = buildLogicalSchematic(sheet({ components: [multiPart] }));

	assert.deepEqual(logical.nodes[0].ports.flatMap((port) => port.numbers).sort(), ['1', '2']);
});

test('uses hidden pin net names as logical power connections', () => {
	const hiddenPower = {
		...pin('VCC', '8', 0, 0),
		hidden: true,
		hiddenNetName: 'VCC_3V3'
	};
	const logical = buildLogicalSchematic(sheet({ components: [component('U1', [hiddenPower])] }));

	assert.deepEqual(
		logical.nodes[0].powerPorts.map((port) => port.netName),
		['VCC_3V3']
	);
});

test('marks ports, off-sheet connectors and sheet entries as external nets', () => {
	for (const field of ['ports', 'offSheetConnectors', 'sheetEntries'] as const) {
		const logical = buildLogicalSchematic(
			sheet({
				components: [component('U1', [pin('IO', '1', 0, 0)])],
				wires: [
					{
						points: [
							{ x: 10, y: 0 },
							{ x: 30, y: 0 }
						]
					}
				],
				[field]: [{ x: 30, y: 0, name: 'EXT_IO' }]
			})
		);
		const net = logical.nets.find((candidate) => candidate.name === 'EXT_IO');
		assert.equal(net?.external, true, field);
	}
});

test('merges disconnected labels with the same explicit net name', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [
				component('U1', [pin('SDA', '1', 0, 0)]),
				component('U2', [pin('SDA', '1', 200, 0)])
			],
			netLabels: [
				{ x: 10, y: 0, text: 'SDA' },
				{ x: 210, y: 0, text: 'SDA' }
			]
		})
	);

	const sda = logical.nets.find((net) => net.name === 'SDA');
	assert.ok(sda);
	assert.equal(sda.ports.length, 2);
});

test('merges same-name external connectors into one logical net', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [
				component('J1', [pin('IO', '1', 0, 0)]),
				component('U1', [pin('IO', '1', 200, 0)])
			],
			offSheetConnectors: [
				{ x: 10, y: 0, name: 'REMOTE_IO' },
				{ x: 210, y: 0, name: 'REMOTE_IO' }
			]
		})
	);

	const remote = logical.nets.find((net) => net.name === 'REMOTE_IO');
	assert.ok(remote);
	assert.equal(remote.external, true);
	assert.equal(remote.ports.length, 2);
});

test('merges same-name bus entries into one external logical net', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [
				component('U1', [pin('D0', '1', 0, 0)]),
				component('U2', [pin('D0', '1', 200, 0)])
			],
			buses: [
				{
					points: [
						{ x: 10, y: 20 },
						{ x: 210, y: 20 }
					]
				}
			],
			busEntries: [
				{ x: 10, y: 0, name: 'DATA[0]' },
				{ x: 210, y: 0, name: 'DATA[0]' }
			]
		})
	);

	const data = logical.nets.find((net) => net.name === 'DATA[0]');
	assert.ok(data);
	assert.equal(data.external, true);
	assert.equal(data.ports.length, 2);
});

test('connects hidden pins to visible labels with the same net name', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [
				component('U1', [{ ...pin('PWR', '1', 0, 0), hidden: true, hiddenNetName: 'VBAT' }]),
				component('R1', [pin('VBAT', '1', 200, 0)])
			],
			netLabels: [{ x: 210, y: 0, text: 'VBAT' }]
		})
	);

	const vbat = logical.nets.find((net) => net.name === 'VBAT');
	assert.ok(vbat);
	assert.equal(vbat.ports.length, 2);
	assert.deepEqual(
		logical.nodes.find((node) => node.label === 'U1')?.ports.map((port) => port.netName),
		['VBAT']
	);
});

test('uses hidden net labels for logical connectivity', () => {
	const logical = buildLogicalSchematic(
		sheet({
			components: [component('U1', [pin('IO', '1', 0, 0)])],
			wires: [
				{
					points: [
						{ x: 10, y: 0 },
						{ x: 100, y: 0 }
					]
				}
			],
			netLabels: [{ x: 50, y: 0, text: 'INTERNAL_IO', hidden: true }]
		})
	);

	assert.deepEqual(
		logical.nodes[0].ports.map((port) => port.netName),
		['INTERNAL_IO']
	);
});

test('resolves a physical pin net only when the association is unambiguous', () => {
	assert.equal(
		resolveUniquePinNet(
			[
				{ pinNumber: '1', net: 'SENSE' },
				{ pinNumber: '1', net: 'sense' }
			],
			['1']
		),
		'sense'
	);
	assert.equal(
		resolveUniquePinNet(
			[
				{ pinNumber: '1', net: 'SENSE_A' },
				{ pinNumber: '1', net: 'SENSE_B' }
			],
			['1']
		),
		undefined
	);
});
