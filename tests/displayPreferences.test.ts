import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parsePcbDisplayPreferences,
	projectPreferenceKey
} from '../src/lib/domain/displayPreferences.ts';

test('builds a stable project-specific display preference key', () => {
	const a = [
		{ name: 'pcb.json', size: 20 },
		{ name: 'bom.json', size: 10 }
	];
	assert.equal(
		projectPreferenceKey(a, [{ name: 'candidate.json', size: 30 }]),
		projectPreferenceKey([...a].reverse(), [{ name: 'candidate.json', size: 30 }])
	);
});

test('restores known PCB preferences and clamps unsafe values', () => {
	const preferences = parsePcbDisplayPreferences(
		JSON.stringify({
			version: 1,
			visibleLayers: { 'Top Layer': false, Unknown: false },
			layerOpacities: { 'Top Layer': 3, 'Bottom Layer': 0 },
			viewMode: 'overlay',
			showPlanes: false,
			showDesignators: true,
			sliderPosition: -2
		}),
		['Top Layer', 'Bottom Layer']
	);

	assert.deepEqual(preferences.visibleLayers, { 'Top Layer': false, 'Bottom Layer': true });
	assert.deepEqual(preferences.layerOpacities, { 'Top Layer': 1, 'Bottom Layer': 0.05 });
	assert.equal(preferences.viewMode, 'overlay');
	assert.equal(preferences.showPlanes, false);
	assert.equal(preferences.showDesignators, true);
	assert.equal(preferences.sliderPosition, 0);
});

test('falls back to defaults for incompatible preferences', () => {
	const preferences = parsePcbDisplayPreferences('{"version":99}', ['Top Layer']);
	assert.equal(preferences.viewMode, 'diff');
	assert.equal(preferences.showComponents, true);
	assert.equal(preferences.visibleLayers['Top Layer'], true);
});
