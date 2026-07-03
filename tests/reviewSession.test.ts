import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewSession, parseReviewSession } from '../src/lib/domain/reviewSession.ts';

test('round-trips a compatible review session', () => {
	const session = createReviewSession('project-pair', ['COMPONENT:R1'], {
		'COMPONENT:R1': 'Value checked'
	});
	const imported = parseReviewSession(
		JSON.stringify(session),
		'project-pair',
		new Set(['COMPONENT:R1'])
	);

	assert.deepEqual(imported.reviewed, ['COMPONENT:R1']);
	assert.deepEqual(imported.notes, { 'COMPONENT:R1': 'Value checked' });
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
});
