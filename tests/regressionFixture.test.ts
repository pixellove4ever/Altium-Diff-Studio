import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	getBomDiff,
	getPcbDiffBundle,
	getSchematicComponentDiff
} from '../src/lib/diff/altiumDiff.ts';
import { buildLogicalSchematic } from '../src/lib/domain/schematicGraph.ts';
import type { AltiumBomDoc, AltiumPcbDoc, AltiumSchematicDoc } from '../src/lib/types/altium.ts';

function fixture<T>(side: 'a' | 'b', name: string): T {
	return JSON.parse(
		readFileSync(new URL(`./fixtures/regression-${side}/${name}.json`, import.meta.url), 'utf8')
	) as T;
}

test('keeps the cross-view regression pair coherent', () => {
	const bomA = fixture<AltiumBomDoc>('a', 'bom');
	const bomB = fixture<AltiumBomDoc>('b', 'bom');
	const pcbA = fixture<AltiumPcbDoc>('a', 'pcb');
	const pcbB = fixture<AltiumPcbDoc>('b', 'pcb');
	const schematicA = fixture<AltiumSchematicDoc>('a', 'schematic');
	const schematicB = fixture<AltiumSchematicDoc>('b', 'schematic');

	assert.equal(getBomDiff(bomA, bomB).find((item) => item.designator === 'R1')?.status, 'modified');
	assert.equal(
		getSchematicComponentDiff(schematicA, schematicB).find((item) => item.designator === 'R1')
			?.status,
		'modified'
	);

	const pcbDiff = getPcbDiffBundle(pcbA, pcbB);
	assert.equal(pcbDiff.tracks.filter((item) => item.status !== 'unchanged').length, 1);
	assert.equal(pcbDiff.vias.filter((item) => item.status === 'added').length, 1);
	assert.ok(pcbDiff.polygons.every((item) => item.status === 'unchanged'));

	const logical = buildLogicalSchematic(schematicB.sheets[0]);
	const sense = logical.nets.find((net) => net.name === 'SENSE');
	assert.ok(sense);
	assert.ok(sense.testpoints.includes('TP1'));
});
