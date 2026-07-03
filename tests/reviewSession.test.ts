import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewSession, parseReviewSession } from '../src/lib/domain/reviewSession.ts';

test('round-trips a compatible review session', () => {
	const session = createReviewSession(
		'project-pair',
		['COMPONENT:R1'],
		{
			'COMPONENT:R1': 'Value checked'
		},
		{
			'COMPONENT:R1': {
				dataUrl: 'data:image/jpeg;base64,abc',
				view: 'PCB',
				capturedAt: '2026-07-03T10:00:00.000Z'
			}
		}
	);
	const imported = parseReviewSession(
		JSON.stringify(session),
		'project-pair',
		new Set(['COMPONENT:R1'])
	);

	assert.deepEqual(imported.reviewed, ['COMPONENT:R1']);
	assert.deepEqual(imported.notes, { 'COMPONENT:R1': 'Value checked' });
	assert.equal(imported.snapshots['COMPONENT:R1']?.view, 'PCB');
});

test('rejects a session from another project pair', () => {
	const session = createReviewSession('other-pair', [], {});

	assert.throws(
		() => parseReviewSession(JSON.stringify(session), 'current-pair', new Set()),
		/different project pair/
	);
});

test('discards review entries that no longer exist', () => {
	const session = createReviewSession('project-pair', ['COMPONENT:R1', 'COMPONENT:R2'], {
		'COMPONENT:R1': 'Keep',
		'COMPONENT:R2': 'Discard'
	});
	const imported = parseReviewSession(
		JSON.stringify(session),
		'project-pair',
		new Set(['COMPONENT:R1'])
	);

	assert.deepEqual(imported.reviewed, ['COMPONENT:R1']);
	assert.deepEqual(imported.notes, { 'COMPONENT:R1': 'Keep' });
	assert.deepEqual(imported.snapshots, {});
});

test('imports legacy version 1 sessions without snapshots', () => {
	const imported = parseReviewSession(
		JSON.stringify({
			format: 'altium-diff-review',
			version: 1,
			projectKey: 'project-pair',
			reviewed: ['COMPONENT:R1'],
			notes: { 'COMPONENT:R1': 'Legacy' }
		}),
		'project-pair',
		new Set(['COMPONENT:R1'])
	);

	assert.deepEqual(imported.snapshots, {});
	assert.deepEqual(imported.notes, { 'COMPONENT:R1': 'Legacy' });
});

test('rejects unsafe snapshot URLs from imported sessions', () => {
	const imported = parseReviewSession(
		JSON.stringify({
			format: 'altium-diff-review',
			version: 2,
			projectKey: 'project-pair',
			reviewed: [],
			notes: {},
			snapshots: {
				'COMPONENT:R1': {
					dataUrl: 'data:text/html;base64,PHNjcmlwdD4=',
					view: 'PCB',
					capturedAt: '2026-07-03'
				}
			}
		}),
		'project-pair',
		new Set(['COMPONENT:R1'])
	);

	assert.deepEqual(imported.snapshots, {});
});
