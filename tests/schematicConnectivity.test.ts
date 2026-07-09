import assert from 'node:assert/strict';
import test from 'node:test';
import {
	activeSchematicPins,
	buildSchematicHierarchyLinks,
	buildSchematicNetCatalog,
	collectHiddenPinConnections,
	collectSchematicNetAnchors,
	diagnoseSchematicConnectivity,
	diagnoseSchematicHierarchy,
	expandBusEntryNetNames
} from '../src/lib/domain/schematicConnectivity.ts';
import type { AltiumSchComponent, AltiumSchSheet } from '../src/lib/types/altium.ts';

function component(overrides: Partial<AltiumSchComponent>): AltiumSchComponent {
	return {
		designator: 'U1',
		comment: 'MCU',
		libRef: 'MCU',
		x: 0,
		y: 0,
		pins: [],
		...overrides
	};
}

function sheet(overrides: Partial<AltiumSchSheet>): AltiumSchSheet {
	return {
		components: [],
		wires: [],
		netLabels: [],
		...overrides
	};
}

test('collects explicit schematic net anchors with source and external metadata', () => {
	const anchors = collectSchematicNetAnchors(
		sheet({
			netLabels: [{ x: 0, y: 0, text: 'LOCAL', hidden: true }],
			ports: [{ x: 10, y: 0, name: 'PORT_IO' }],
			offSheetConnectors: [{ x: 20, y: 0, text: 'REMOTE_IO' }],
			sheetEntries: [{ x: 30, y: 0, name: 'CHILD_IO' }],
			busEntries: [{ x: 40, y: 0, name: 'DATA[0]' }]
		})
	);

	assert.deepEqual(
		anchors.map((anchor) => ({
			name: anchor.name,
			source: anchor.source,
			external: anchor.external,
			hidden: anchor.hidden
		})),
		[
			{ name: 'LOCAL', source: 'netLabel', external: false, hidden: true },
			{ name: 'PORT_IO', source: 'port', external: true, hidden: false },
			{ name: 'REMOTE_IO', source: 'offSheetConnector', external: true, hidden: false },
			{ name: 'CHILD_IO', source: 'sheetEntry', external: true, hidden: false },
			{ name: 'DATA[0]', source: 'busEntry', external: true, hidden: false }
		]
	);
});

test('hidden pin collection respects active multi-part component state', () => {
	const multiPart = component({
		currentPartId: 1,
		displayMode: 0,
		pins: [
			{
				num: '1',
				name: 'VCCA',
				x: 0,
				y: 0,
				orientation: 0,
				hidden: true,
				hiddenNetName: 'VCCA',
				ownerPartId: 1,
				ownerPartDisplayMode: 0
			},
			{
				num: '2',
				name: 'VCCB',
				x: 0,
				y: 20,
				orientation: 0,
				hidden: true,
				hiddenNetName: 'VCCB',
				ownerPartId: 2,
				ownerPartDisplayMode: 0
			}
		]
	});

	assert.deepEqual(
		activeSchematicPins(multiPart).map((pin) => pin.num),
		['1']
	);
	assert.deepEqual(
		collectHiddenPinConnections(sheet({ components: [multiPart] })).map((connection) => ({
			pinNumber: connection.pinNumber,
			net: connection.net
		})),
		[{ pinNumber: '1', net: 'VCCA' }]
	);
});

test('infers safe hidden power pin nets when hidden net names are missing', () => {
	const connections = collectHiddenPinConnections(
		sheet({
			components: [
				component({
					pins: [
						{ num: '1', name: 'VCC', x: 0, y: 0, orientation: 0, hidden: true },
						{ num: '2', name: 'DATA', x: 0, y: 10, orientation: 0, hidden: true }
					]
				})
			]
		})
	);

	assert.deepEqual(
		connections.map((connection) => ({ pinNumber: connection.pinNumber, net: connection.net })),
		[{ pinNumber: '1', net: 'VCC' }]
	);
});

test('builds a schematic net catalog from labels, wires, external anchors and hidden pins', () => {
	const catalog = buildSchematicNetCatalog([
		sheet({
			components: [
				component({
					designator: 'U1',
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
				})
			],
			wires: [{ points: [{ x: 0, y: 0 }], net: 'WIRE_NET' }],
			netLabels: [{ x: 0, y: 0, text: 'LOCAL' }],
			sheetEntries: [{ x: 10, y: 0, name: 'CHILD_IO' }],
			busEntries: [{ x: 20, y: 0, name: 'DATA[0]' }]
		})
	]);

	assert.deepEqual(Array.from(catalog.keys()).sort(), [
		'CHILD_IO',
		'DATA[0]',
		'LOCAL',
		'VCC_3V3',
		'WIRE_NET'
	]);
	assert.equal(catalog.get('CHILD_IO')?.external, true);
	assert.equal(catalog.get('DATA[0]')?.external, true);
	assert.deepEqual(Array.from(catalog.get('VCC_3V3')?.components ?? []), ['U1']);
	assert.deepEqual(Array.from(catalog.get('WIRE_NET')?.sources ?? []), ['wire']);
});

test('expands named bus-entry ranges into bit nets for the schematic net catalog', () => {
	assert.deepEqual(expandBusEntryNetNames('DATA[0..3]'), [
		'DATA[0]',
		'DATA[1]',
		'DATA[2]',
		'DATA[3]'
	]);
	assert.deepEqual(expandBusEntryNetNames('ADDR<3:1>'), ['ADDR[3]', 'ADDR[2]', 'ADDR[1]']);
	assert.deepEqual(expandBusEntryNetNames('DATA[0]'), ['DATA[0]']);

	const catalog = buildSchematicNetCatalog([
		sheet({
			busEntries: [
				{ x: 0, y: 0, name: 'DATA[0..2]' },
				{ x: 10, y: 0, name: 'ADDR<2:1>' }
			]
		})
	]);

	assert.deepEqual(Array.from(catalog.keys()).sort(), [
		'ADDR[1]',
		'ADDR[2]',
		'DATA[0]',
		'DATA[1]',
		'DATA[2]'
	]);
	assert.equal(catalog.get('DATA[1]')?.external, true);
	assert.deepEqual(Array.from(catalog.get('ADDR[2]')?.sources ?? []), ['busEntry']);
});

test('diagnoses ambiguous names on the same physical schematic node', () => {
	const diagnostics = diagnoseSchematicConnectivity(
		sheet({
			wires: [
				{
					points: [
						{ x: 0, y: 0 },
						{ x: 100, y: 0 }
					]
				}
			],
			netLabels: [
				{ x: 0, y: 0, text: 'SDA' },
				{ x: 100, y: 0, text: 'SCL' }
			]
		}),
		'sheets[0]'
	);

	assert.equal(diagnostics.length, 1);
	assert.equal(diagnostics[0].severity, 'warning');
	assert.match(diagnostics[0].message, /SDA, SCL/);
});

test('diagnoses unsupported bus connectivity and missing sheet-symbol ownership', () => {
	const diagnostics = diagnoseSchematicConnectivity(
		sheet({
			buses: [
				{
					points: [
						{ x: 0, y: 0 },
						{ x: 100, y: 0 }
					]
				}
			],
			sheetSymbols: [{ x: 0, y: 0, uniqueId: 'sheet-a', name: 'Child' }],
			sheetEntries: [{ x: 10, y: 0, name: 'DATA', ownerSheetSymbolUniqueId: 'missing-symbol' }]
		}),
		'sheets[0]'
	);

	assert.ok(diagnostics.some((diagnostic) => /Bus graphics/.test(diagnostic.message)));
	assert.ok(diagnostics.some((diagnostic) => /missing sheet symbol/.test(diagnostic.message)));
});

test('does not warn about named bus entries that can be cataloged explicitly', () => {
	const diagnostics = diagnoseSchematicConnectivity(
		sheet({
			buses: [
				{
					points: [
						{ x: 0, y: 0 },
						{ x: 100, y: 0 }
					]
				}
			],
			busEntries: [{ x: 50, y: 0, name: 'DATA[0]' }]
		}),
		'sheets[0]'
	);

	assert.ok(!diagnostics.some((diagnostic) => /Bus graphics/.test(diagnostic.message)));
});

test('diagnoses hidden pins whose net names cannot be inferred safely', () => {
	const diagnostics = diagnoseSchematicConnectivity(
		sheet({
			components: [
				component({
					pins: [{ num: '1', name: 'DATA', x: 0, y: 0, orientation: 0, hidden: true }]
				})
			]
		}),
		'sheets[0]'
	);

	assert.ok(diagnostics.some((diagnostic) => /Hidden pin "DATA"/.test(diagnostic.message)));
});

test('diagnoses mismatched parent sheet entries and child sheet ports', () => {
	const diagnostics = diagnoseSchematicHierarchy([
		sheet({
			name: 'Top',
			sheetSymbols: [{ x: 0, y: 0, uniqueId: 'child-symbol', fileName: 'Child.SchDoc' }],
			sheetEntries: [
				{ x: 0, y: 0, name: 'DATA_IN', ownerSheetSymbolUniqueId: 'child-symbol' },
				{ x: 0, y: 10, name: 'MISSING_ON_CHILD', ownerSheetSymbolUniqueId: 'child-symbol' }
			]
		}),
		sheet({
			name: 'Child',
			fileName: 'Child.SchDoc',
			ports: [
				{ x: 0, y: 0, name: 'DATA_IN' },
				{ x: 0, y: 10, name: 'UNDECLARED_PARENT' }
			]
		})
	]);

	assert.ok(diagnostics.some((diagnostic) => /MISSING_ON_CHILD/.test(diagnostic.message)));
	assert.ok(diagnostics.some((diagnostic) => /UNDECLARED_PARENT/.test(diagnostic.message)));
});

test('builds hierarchy links between parent sheet entries and child ports', () => {
	const sheets = [
		sheet({
			name: 'Top',
			sheetSymbols: [
				{ x: 0, y: 0, uniqueId: 'child-symbol', name: 'Child Block', fileName: 'Child.SchDoc' }
			],
			sheetEntries: [
				{ x: 10, y: 0, name: 'DATA_IN', ownerSheetSymbolUniqueId: 'child-symbol' },
				{ x: 10, y: 10, name: 'REMOTE_OUT', ownerSheetSymbolUniqueId: 'child-symbol' },
				{ x: 10, y: 20, name: 'MISSING', ownerSheetSymbolUniqueId: 'child-symbol' }
			]
		}),
		sheet({
			name: 'Child',
			fileName: 'Child.SchDoc',
			ports: [{ x: 0, y: 0, name: 'DATA_IN' }],
			offSheetConnectors: [{ x: 0, y: 10, name: 'REMOTE_OUT' }]
		})
	];
	const links = buildSchematicHierarchyLinks(sheets);

	assert.deepEqual(
		links.map((link) => ({
			name: link.name,
			parentSheetIndex: link.parentSheetIndex,
			parentSymbolIndex: link.parentSymbolIndex,
			childSheetIndex: link.childSheetIndex,
			childSource: link.childSource
		})),
		[
			{
				name: 'DATA_IN',
				parentSheetIndex: 0,
				parentSymbolIndex: 0,
				childSheetIndex: 1,
				childSource: 'port'
			},
			{
				name: 'REMOTE_OUT',
				parentSheetIndex: 0,
				parentSymbolIndex: 0,
				childSheetIndex: 1,
				childSource: 'offSheetConnector'
			}
		]
	);
	assert.equal(links[0].parentEntry.x, 10);
	assert.equal(links[0].childPort.x, 0);

	const catalog = buildSchematicNetCatalog(sheets);
	assert.deepEqual(Array.from(catalog.get('DATA_IN')?.sources ?? []).sort(), [
		'hierarchy',
		'port',
		'sheetEntry'
	]);
	assert.equal(catalog.get('REMOTE_OUT')?.external, true);
});
