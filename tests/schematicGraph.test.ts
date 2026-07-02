import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLogicalSchematic, isPowerNet } from '../src/lib/domain/schematicGraph.ts';
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
	for (const name of ['GPIO5', 'CLOCK', 'RESET_N', 'SDA']) {
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
