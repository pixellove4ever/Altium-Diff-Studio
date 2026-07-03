import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewReportHtml } from '../src/lib/domain/reviewReport.ts';

test('escapes project and review content in HTML reports', () => {
	const html = createReviewReportHtml({
		title: '<Project & review>',
		generatedAt: '2026-07-03',
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
		captures: []
	});

	assert.match(html, /&lt;Project &amp; review&gt;/);
	assert.match(html, /R1&lt;script&gt;/);
	assert.match(html, /&lt;b&gt;checked&lt;\/b&gt;/);
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /Review snapshots/);
	assert.match(html, /data:image\/jpeg;base64,abc/);
});
