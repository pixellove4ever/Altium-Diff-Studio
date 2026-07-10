import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getPcbDiffBundle } from '../src/lib/diff/altiumDiff.ts';
import {
	applyProjectFiles,
	exporterCompatibilityWarning,
	type ProjectLoadingState
} from '../src/lib/domain/projectLoading.ts';
import type { AltiumDoc } from '../src/lib/types/altium.ts';

type FileEntry = { name: string; doc: AltiumDoc };

const emptyState = (): ProjectLoadingState<FileEntry> => ({
	filesA: [],
	filesB: [],
	projectA: { bom: null, pcb: null, schematic: null },
	projectB: { bom: null, pcb: null, schematic: null }
});

function fixture(side: 'a' | 'b', name: 'bom' | 'pcb' | 'schematic'): FileEntry {
	const doc = JSON.parse(
		readFileSync(new URL(`./fixtures/regression-${side}/${name}.json`, import.meta.url), 'utf8')
	) as AltiumDoc;
	return { name: `${name}.json`, doc };
}

test('loads version A then B and exposes a comparable workspace', () => {
	const filesA = ['bom', 'pcb', 'schematic'].map((name) =>
		fixture('a', name as 'bom' | 'pcb' | 'schematic')
	);
	const filesB = ['bom', 'pcb', 'schematic'].map((name) =>
		fixture('b', name as 'bom' | 'pcb' | 'schematic')
	);

	const afterA = applyProjectFiles(emptyState(), 'A', filesA);
	assert.equal(afterA.error, null);
	assert.ok(afterA.state.projectA.pcb);
	assert.equal(afterA.state.projectB.pcb, null);

	const afterB = applyProjectFiles(afterA.state, 'B', filesB);
	assert.equal(afterB.error, null);
	assert.ok(afterB.state.projectA.pcb);
	assert.ok(afterB.state.projectB.pcb);
	const diff = getPcbDiffBundle(afterB.state.projectA.pcb, afterB.state.projectB.pcb);
	assert.equal(diff.vias.filter((item) => item.status === 'added').length, 1);
});

test('keeps the existing workspace when B has no comparable document type', () => {
	const afterA = applyProjectFiles(emptyState(), 'A', [fixture('a', 'pcb')]);
	const incompatibleB = applyProjectFiles(afterA.state, 'B', [fixture('b', 'bom')]);

	assert.match(incompatibleB.error ?? '', /Types incompatibles/);
	assert.equal(incompatibleB.state, afterA.state);
	assert.equal(incompatibleB.state.filesB.length, 0);
});

test('prefers the richest PCB export over a panel PCB when multiple PCB files are loaded', () => {
	const board = fixture('a', 'pcb');
	board.doc.fileName = 'AGMA_pcb.json';
	const panel: FileEntry = {
		name: 'PANEL_AGMA_pcb.json',
		doc: {
			type: 'pcb',
			fileName: 'PANEL_AGMA_pcb.json',
			fileSize: 1,
			components: Array.from({ length: 10 }, (_, index) => ({
				designator: `Designator${index + 1}`,
				comment: 'COMMENT',
				footprint: '',
				layer: 'Top Layer',
				x: index,
				y: index,
				rotation: 0
			})),
			tracks: Array.from({ length: 956 }, (_, index) => ({
				layer: 'Mechanical 1',
				start: { x: index, y: 0 },
				end: { x: index + 1, y: 0 },
				width: 0.1
			})),
			pads: Array.from({ length: 10 }, (_, index) => ({
				designator: `${index + 1}`,
				component: `Designator${index + 1}`,
				x: index,
				y: index,
				size: { x: 1, y: 1 },
				shape: 'round',
				holeSize: 0,
				layer: 'Top Layer'
			})),
			vias: [],
			layers: ['Top Layer', 'Mechanical 1']
		}
	};

	const loaded = applyProjectFiles(emptyState(), 'A', [board, panel]);

	assert.equal(loaded.error, null);
	assert.equal(loaded.state.projectA.pcb?.fileName, 'AGMA_pcb.json');
});

test('accepts one exporter version across different document schemas', () => {
	const files: FileEntry[] = [
		{
			name: 'pcb.json',
			doc: {
				type: 'pcb',
				fileName: 'pcb.json',
				fileSize: 1,
				schemaVersion: 'ads-json-pcb-v2',
				exportMeta: {
					scriptName: 'ExportDesignData_ADS.pas',
					scriptVersion: '71',
					schemaVersion: 'ads-json-pcb-v2'
				},
				components: [],
				tracks: [],
				pads: [],
				vias: [],
				layers: []
			}
		},
		{
			name: 'schematic.json',
			doc: {
				type: 'schematic',
				fileName: 'schematic.json',
				fileSize: 1,
				schemaVersion: 'ads-json-sch-v2',
				exportMeta: {
					scriptName: 'ExportDesignData_ADS.pas',
					scriptVersion: '71',
					schemaVersion: 'ads-json-sch-v2'
				},
				sheets: [{ components: [], wires: [], netLabels: [] }]
			}
		},
		{
			name: 'bom.json',
			doc: {
				type: 'bom',
				fileName: 'bom.json',
				fileSize: 1,
				schemaVersion: 'ads-json-bom-v1',
				exportMeta: {
					scriptName: 'ExportDesignData_ADS.pas',
					scriptVersion: '71',
					schemaVersion: 'ads-json-bom-v1'
				},
				items: []
			}
		}
	];

	assert.equal(exporterCompatibilityWarning(files), null);
});

test('warns when exporter script versions differ', () => {
	const files = [fixture('a', 'pcb'), fixture('b', 'pcb')];
	files[0].doc.exportMeta = { scriptName: 'ExportDesignData_ADS.pas', scriptVersion: '71' };
	files[1].doc.exportMeta = { scriptName: 'ExportDesignData_ADS.pas', scriptVersion: '72' };

	assert.match(exporterCompatibilityWarning(files) ?? '', /version de l.exporteur/);
});
