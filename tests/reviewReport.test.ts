import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewReportHtml } from '../src/lib/domain/reviewReport.ts';

test('escapes project and review content in HTML reports', () => {
	const html = createReviewReportHtml({
		title: '<Project & review>',
		locale: 'en',
		generatedAt: '2026-07-03',
		scope: 'complete',
		totalChanges: 1,
		changes: [
			{
				key: 'COMPONENT:R1',
				kind: 'component',
				value: 'R1<script>',
				status: 'modified',
				sources: ['pcb'],
				summary: '10k → 22k'
			}
		],
		reviewed: new Set(['COMPONENT:R1']),
		notes: { 'COMPONENT:R1': '<b>checked</b>' },
		snapshots: {
			'COMPONENT:R1': {
				dataUrl: 'data:image/jpeg;base64,abc',
				view: 'PCB',
				capturedAt: '2026-07-03T10:00:00.000Z'
			}
		},
		stats: {
			statuses: { added: 0, modified: 1, removed: 0 },
			sources: { pcb: 1, schematic: 0, bom: 0 },
			components: 1,
			nets: 0
		},
		captures: [],
		files: [],
		diagnostics: []
	});

	assert.match(html, /&lt;Project &amp; review&gt;/);
	assert.match(html, /R1&lt;script&gt;/);
	assert.match(html, /&lt;b&gt;checked&lt;\/b&gt;/);
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /Review snapshots/);
	assert.match(html, /data:image\/jpeg;base64,abc/);
});

test('includes source metadata, diagnostics and filtered review coverage', () => {
	const html = createReviewReportHtml({
		title: 'Board review',
		locale: 'en',
		generatedAt: '2026-07-03',
		scope: 'filtered',
		totalChanges: 4,
		changes: [
			{
				key: 'NET:VCC',
				kind: 'net',
				value: 'VCC',
				status: 'added',
				sources: ['pcb'],
				summary: '2 changed tracks'
			}
		],
		reviewed: new Set(['NET:VCC']),
		notes: {},
		snapshots: {},
		stats: {
			statuses: { added: 0, modified: 4, removed: 0 },
			sources: { pcb: 4, schematic: 0, bom: 0 },
			components: 4,
			nets: 0
		},
		captures: [],
		files: [
			{
				side: 'A',
				name: 'C:\\project\\board.json',
				size: 2048,
				type: 'pcb',
				exportMeta: {
					scriptName: 'ADS Exporter',
					scriptVersion: '2.1',
					schemaVersion: '2'
				}
			}
		],
		diagnostics: [
			{ side: 'A', file: 'board.json', severity: 'warning', message: 'Outline missing.' }
		]
	});

	assert.match(html, /Filtered review report/);
	assert.match(html, /1 \/ 4 changes/);
	assert.match(html, /25% overall review coverage/);
	assert.match(html, /C:\\project\\board\.json/);
	assert.match(html, /ADS Exporter 2\.1/);
	assert.match(html, /Outline missing\./);
	assert.match(html, /1 added/);
	assert.doesNotMatch(html, /4 modified/);
});
