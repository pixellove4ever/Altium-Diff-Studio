import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAdsDocument } from '../src/lib/domain/adsValidation.ts';
import type { AltiumBomDoc, AltiumPcbDoc, AltiumSchematicDoc } from '../src/lib/types/altium.ts';

const pcb = (): AltiumPcbDoc => ({
	type: 'pcb',
	fileName: 'board.json',
	fileSize: 1,
	layers: ['Top Layer'],
	components: [],
	tracks: [],
	pads: [],
	vias: []
});

test('blocks invalid PCB coordinate and dimension types', () => {
	const document = pcb();
	document.tracks.push({
		layer: 'Top Layer',
		start: { x: '12' as unknown as number, y: 0 },
		end: { x: 10, y: 0 },
		width: -0.2
	});
	const issues = validateAdsDocument(document);

	assert.ok(issues.some((issue) => issue.severity === 'error' && issue.path.endsWith('start.x')));
	assert.ok(issues.some((issue) => issue.severity === 'error' && issue.path.endsWith('width')));
});

test('reports duplicate PCB designators and net names', () => {
	const document = pcb();
	document.components = [
		{
			designator: 'J1',
			comment: '',
			footprint: 'USB',
			layer: 'Top Layer',
			x: 0,
			y: 0,
			rotation: 0
		},
		{ designator: 'j1', comment: '', footprint: 'USB', layer: 'Top Layer', x: 1, y: 0, rotation: 0 }
	];
	document.nets = ['GND', 'gnd'];
	const issues = validateAdsDocument(document);

	assert.ok(issues.some((issue) => issue.severity === 'error' && /designator/.test(issue.message)));
	assert.ok(issues.some((issue) => issue.severity === 'warning' && /net/.test(issue.message)));
});

test('keeps duplicate BOM designators recoverable', () => {
	const document: AltiumBomDoc = {
		type: 'bom',
		fileName: 'bom.json',
		fileSize: 1,
		items: [
			{ designator: 'R1', comment: '10k', footprint: '0402' },
			{ designator: 'r1', comment: '10k', footprint: '0402' }
		]
	};
	const issues = validateAdsDocument(document);

	assert.deepEqual(
		issues.map((issue) => issue.severity),
		['warning']
	);
});

test('does not warn on large schematic drawing coordinates', () => {
	const document: AltiumSchematicDoc = {
		type: 'schematic',
		fileName: 'schematic.json',
		fileSize: 1,
		sheets: [
			{
				name: 'Sheet 1',
				components: [
					{
						designator: 'U1',
						comment: '',
						x: 2_000_000,
						y: 2_000_000,
						pins: [
							{
								name: 'A',
								number: '1',
								x: 2_000_100,
								y: 2_000_100,
								orientation: 0
							}
						]
					}
				],
				wires: [
					{
						points: [
							{ x: 2_000_000, y: 2_000_000 },
							{ x: 2_000_200, y: 2_000_000 }
						]
					}
				],
				netLabels: [],
				annotations: []
			}
		]
	};

	assert.equal(validateAdsDocument(document).length, 0);
});

test('reports schematic connectivity ambiguity diagnostics', () => {
	const document: AltiumSchematicDoc = {
		type: 'schematic',
		fileName: 'schematic.json',
		fileSize: 1,
		sheets: [
			{
				name: 'Sheet 1',
				components: [],
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
				],
				buses: [
					{
						points: [
							{ x: 0, y: 20 },
							{ x: 100, y: 20 }
						]
					}
				]
			}
		]
	};
	const issues = validateAdsDocument(document);

	assert.ok(issues.some((issue) => /multiple net names/.test(issue.message)));
	assert.ok(issues.some((issue) => /Bus graphics/.test(issue.message)));
});
