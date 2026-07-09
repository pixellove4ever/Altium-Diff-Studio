import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAltiumJson } from '../src/lib/domain/adsImport.ts';

test('normalizes native schematic component records and preserves multi-part metadata', () => {
	const document = normalizeAltiumJson(
		{
			type: 'schematic',
			schemaVersion: 'native-probe',
			sheets: [
				{
					name: 'Sheet 1',
					components: [
						{
							DESIGNATOR: 'U1',
							COMMENT: 'MCU',
							LIBREF: 'STM32',
							UNIQUEID: 'cmp-1',
							SOURCELIBRARYNAME: 'Integrated Library',
							OWNERINDEX: 42,
							CURRENTPARTID: 2,
							DISPLAYMODE: 1,
							PARTCOUNT: 3,
							X: 100,
							Y: 200,
							BOUNDS: { X1: 90, Y1: 180, X2: 130, Y2: 220 },
							SYMBOLGRAPHICS: [
								{ TYPE: 'line', X1: 90, Y1: 180, X2: 130, Y2: 180 },
								{ TYPE: 'polyline', POINTS: [{ X: 90, Y: 220 }] }
							],
							TEXTRENDER: [{ TYPE: 'designator', ROLE: 'designator', TEXT: 'U1', X: 95, Y: 170 }],
							Parameters: [
								{ Name: 'Manufacturer', Value: 'ST' },
								{ NAME: 'MPN', VALUE: 'STM32-NATIVE' }
							],
							PINS: [
								{
									NAME: 'VDD',
									PINNUMBER: '1',
									OWNERINDEX: 43,
									OWNERPARTID: 2,
									OWNERPARTDISPLAYMODE: 1,
									X: 110,
									Y: 200,
									ORIENTATION: 180,
									ISHIDDEN: true,
									HIDDENNETNAME: 'VCC_3V3'
								}
							]
						}
					],
					wires: [],
					netLabels: []
				}
			]
		},
		'native-sch.json',
		1234
	);

	assert.equal(document.type, 'schematic');
	const component = document.sheets[0].components[0];
	assert.equal(component.designator, 'U1');
	assert.equal(component.libRef, 'STM32');
	assert.equal(component.sourceLibraryName, 'Integrated Library');
	assert.equal(component.ownerIndex, 42);
	assert.equal(component.currentPartId, 2);
	assert.equal(component.displayMode, 1);
	assert.equal(component.partCount, 3);
	assert.deepEqual(component.bounds, { x1: 90, y1: 180, x2: 130, y2: 220 });
	assert.equal(component.symbolGraphics?.[0].type, 'line');
	assert.equal(component.symbolGraphics?.[0].x1, 90);
	assert.equal(component.symbolGraphics?.[0].x2, 130);
	assert.deepEqual(component.symbolGraphics?.[1].points, [{ x: 90, y: 220 }]);
	assert.equal(component.textRender?.[0].type, 'designator');
	assert.equal(component.textRender?.[0].role, 'designator');
	assert.equal(component.textRender?.[0].text, 'U1');
	assert.equal(component.textRender?.[0].x, 95);
	assert.deepEqual(component.parameters, { Manufacturer: 'ST', MPN: 'STM32-NATIVE' });
	const pin = component.pins[0];
	assert.equal(pin.name, 'VDD');
	assert.equal(pin.num, '1');
	assert.equal(pin.ownerIndex, 43);
	assert.equal(pin.ownerPartId, 2);
	assert.equal(pin.ownerPartDisplayMode, 1);
	assert.equal(pin.x, 110);
	assert.equal(pin.y, 200);
	assert.equal(pin.orientation, 180);
	assert.equal(pin.hidden, true);
	assert.equal(pin.hiddenNetName, 'VCC_3V3');
});

test('normalizes native schematic topology markers for connectivity', () => {
	const document = normalizeAltiumJson(
		{
			type: 'schematic',
			components: [],
			wires: [
				{
					ID: 'wire-1',
					POINTS: [
						{ X: 0, Y: 0 },
						{ X: 100, Y: 0 }
					],
					NET: 'SDA'
				}
			],
			netLabels: [{ TEXT: 'SDA', X: 0, Y: 0 }],
			ports: [{ NAME: 'SDA', X: 100, Y: 0 }],
			powerPorts: [{ TEXT: 'GND', X: 0, Y: 20 }],
			offSheetConnectors: [{ TEXT: 'REMOTE_IO', X: 20, Y: 20 }],
			sheetSymbols: [
				{ UNIQUEID: 'sheet-a', NAME: 'Child', FILENAME: 'child.SchDoc', X: 50, Y: 50 }
			],
			sheetEntries: [{ NAME: 'CHILD_IO', OWNERSHEETSYMBOLUNIQUEID: 'sheet-a', X: 60, Y: 50 }],
			buses: [{ POINTS: [{ X: 0, Y: 100 }] }],
			busEntries: [{ NAME: 'DATA[0]', X: 10, Y: 100 }],
			annotations: [
				{
					TYPE: 'textFrame',
					TEXT: 'Note',
					DISPLAYTEXT: 'Visible note',
					X: 5,
					Y: 5,
					BOUNDS: { X1: 0, Y1: 0, X2: 20, Y2: 10 },
					SHOWBORDER: true,
					WORDWRAP: true
				}
			]
		},
		'native-topology.json',
		1234
	);

	assert.equal(document.type, 'schematic');
	const sheet = document.sheets[0];
	assert.deepEqual(sheet.wires[0].points, [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 }
	]);
	assert.equal(sheet.wires[0].net, 'SDA');
	assert.equal(sheet.netLabels[0].text, 'SDA');
	assert.equal(sheet.ports?.[0].name, 'SDA');
	assert.equal(sheet.powerPorts?.[0].text, 'GND');
	assert.equal(sheet.offSheetConnectors?.[0].text, 'REMOTE_IO');
	assert.equal(sheet.sheetSymbols?.[0].uniqueId, 'sheet-a');
	assert.equal(sheet.sheetSymbols?.[0].fileName, 'child.SchDoc');
	assert.equal(sheet.sheetEntries?.[0].ownerSheetSymbolUniqueId, 'sheet-a');
	assert.equal(sheet.busEntries?.[0].name, 'DATA[0]');
	assert.deepEqual(sheet.buses?.[0].points, [{ x: 0, y: 100 }]);
	assert.equal(sheet.annotations?.[0].type, 'textFrame');
	assert.equal(sheet.annotations?.[0].text, 'Note');
	assert.equal(sheet.annotations?.[0].displayText, 'Visible note');
	assert.equal(sheet.annotations?.[0].x, 5);
	assert.deepEqual(sheet.annotations?.[0].bounds, { x1: 0, y1: 0, x2: 20, y2: 10 });
	assert.equal(sheet.annotations?.[0].showBorder, true);
	assert.equal(sheet.annotations?.[0].wordWrap, true);
});
