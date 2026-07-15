import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parsePcbDisplayPreferences,
	pcbLayerSide,
	projectPreferenceKey,
	projectViewerPreferenceKey,
	visibleLayersForBasicBoardSide,
	visibleLayersForBoardSide
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

test('uses a side-only layer profile for the basic PCB side controls', () => {
	assert.deepEqual(
		visibleLayersForBasicBoardSide(
			['Top Layer', 'Bottom Layer', 'Internal Plane 1', 'Mechanical 1', 'Keep-Out Layer'],
			'top'
		),
		{
			'Top Layer': true,
			'Bottom Layer': false,
			'Internal Plane 1': false,
			'Mechanical 1': false,
			'Keep-Out Layer': false
		}
	);
	assert.deepEqual(
		visibleLayersForBasicBoardSide(['Top Overlay', 'Bottom Overlay', 'Assembly Drawing'], 'bottom'),
		{
			'Top Overlay': false,
			'Bottom Overlay': true,
			'Assembly Drawing': false
		}
	);
});

test('builds a stable project viewer preference key', () => {
	const files = [
		{ name: 'fab.zip', size: 200 },
		{ name: 'board.gtl', size: 100 }
	];
	assert.equal(projectViewerPreferenceKey(files), projectViewerPreferenceKey([...files].reverse()));
	assert.equal(projectViewerPreferenceKey([]), '');
});

test('restores known PCB preferences and clamps unsafe values', () => {
	const preferences = parsePcbDisplayPreferences(
		JSON.stringify({
			version: 1,
			visibleLayers: { 'Top Layer': false, Unknown: false },
			layerOpacities: { 'Top Layer': 3, 'Bottom Layer': 0 },
			viewMode: 'overlay',
			boardSide: 'bottom',
			showPlanes: false,
			showDesignators: true,
			sliderPosition: -2
		}),
		['Top Layer', 'Bottom Layer']
	);

	assert.deepEqual(preferences.visibleLayers, { 'Top Layer': false, 'Bottom Layer': true });
	assert.deepEqual(preferences.layerOpacities, { 'Top Layer': 1, 'Bottom Layer': 0.05 });
	assert.equal(preferences.viewMode, 'overlay');
	assert.equal(preferences.boardSide, 'bottom');
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

test('classifies PCB layers for direct top and bottom controls', () => {
	assert.equal(pcbLayerSide('Top Layer'), 'top');
	assert.equal(pcbLayerSide('Bottom Overlay'), 'bottom');
	assert.equal(pcbLayerSide('Internal Plane 1'), 'inner');
	assert.equal(pcbLayerSide('Mechanical 1'), 'all');

	assert.deepEqual(
		visibleLayersForBoardSide(['Top Layer', 'Bottom Layer', 'Mechanical 1'], 'top'),
		{
			'Top Layer': true,
			'Bottom Layer': false,
			'Mechanical 1': true
		}
	);
	assert.deepEqual(
		visibleLayersForBoardSide(['Top Layer', 'Bottom Layer', 'Mechanical 1'], 'bottom'),
		{
			'Top Layer': false,
			'Bottom Layer': true,
			'Mechanical 1': true
		}
	);
});
