import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseProjectConsistency } from '../src/lib/domain/projectConsistency.ts';
import type { AltiumProjectSet } from '../src/lib/types/altium.ts';

function project(): AltiumProjectSet {
	return {
		schematic: null,
		bom: {
			type: 'bom',
			fileName: 'board_bom.json',
			fileSize: 1,
			items: [
				{ designator: 'R1', comment: '10k', footprint: '0402' },
				{ designator: 'C1', comment: '100nF', footprint: '0402' },
				{ designator: 'R2', comment: 'DNP', footprint: '0402', parameters: { Fitted: 'False' } }
			]
		},
		pcb: {
			type: 'pcb',
			fileName: 'board_pcb.json',
			fileSize: 1,
			layers: ['Top Layer'],
			components: [
				{
					designator: 'R1',
					comment: '10k',
					footprint: '0402',
					layer: 'Top Layer',
					x: 0,
					y: 0,
					rotation: 0
				},
				{
					designator: 'U1',
					comment: 'MCU',
					footprint: 'QFN',
					layer: 'Top Layer',
					x: 10,
					y: 0,
					rotation: 0
				}
			],
			tracks: [],
			pads: [],
			vias: []
		}
	};
}

test('reports fitted BOM components missing from the PCB export', () => {
	const diagnostics = diagnoseProjectConsistency(project());

	assert.ok(diagnostics.some((diagnostic) => /C1/.test(diagnostic.message)));
	assert.ok(!diagnostics.some((diagnostic) => /R2/.test(diagnostic.message)));
});

test('reports PCB components missing from the fitted BOM export', () => {
	const diagnostics = diagnoseProjectConsistency(project());

	assert.ok(diagnostics.some((diagnostic) => /U1/.test(diagnostic.message)));
});

test('does not report cross-source diagnostics when BOM or PCB is absent', () => {
	assert.deepEqual(
		diagnoseProjectConsistency({ bom: project().bom, pcb: null, schematic: null }),
		[]
	);
	assert.deepEqual(
		diagnoseProjectConsistency({ bom: null, pcb: project().pcb, schematic: null }),
		[]
	);
});
