import assert from 'node:assert/strict';
import test from 'node:test';
import {
	compareGerberFiles,
	gerberLayerKey,
	isGerberFileName,
	type GerberFile
} from '../src/lib/diff/fabrication/gerberDiff.ts';

function gerber(name: string, text: string): GerberFile {
	return { name, size: text.length, text };
}

test('detects common Gerber and drill extensions', () => {
	assert.equal(isGerberFileName('board.GTL'), true);
	assert.equal(isGerberFileName('board.gbl'), true);
	assert.equal(isGerberFileName('drill.drl'), true);
	assert.equal(isGerberFileName('notes.txt'), false);
});

test('uses canonical layer extensions as Gerber layer keys', () => {
	assert.equal(gerberLayerKey('Project-TopLayer.GTL'), 'gtl');
	assert.equal(gerberLayerKey('Project-BottomLayer.GBL'), 'gbl');
});

test('compares Gerber layers and line changes', () => {
	const before = [
		gerber('board.GTL', 'G04 top*\nD10*\nX1Y1D03*\nM02*'),
		gerber('board.GBL', 'G04 bottom*\nM02*')
	];
	const after = [
		gerber('board.GTL', 'G04 top*\nD10*\nX1Y1D03*\nX2Y2D03*\nM02*'),
		gerber('board.GTS', 'G04 mask*\nM02*')
	];

	const diff = compareGerberFiles(before, after);

	assert.equal(diff.counts.modified, 1);
	assert.equal(diff.counts.added, 1);
	assert.equal(diff.counts.removed, 1);
	assert.deepEqual(diff.layers.find((layer) => layer.key === 'gtl')?.counts, {
		unchanged: 4,
		added: 1,
		removed: 0
	});
});
