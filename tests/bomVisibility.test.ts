import assert from 'node:assert/strict';
import test from 'node:test';
import {
	bomViewerHiddenReason,
	isMechanicalBomItem,
	isNonMountedBomItem,
	shouldShowBomItemInViewer
} from '../src/lib/domain/bomVisibility.ts';
import type { AltiumBomItem } from '../src/lib/types/altium.ts';

function item(overrides: Partial<AltiumBomItem>): AltiumBomItem {
	return {
		designator: 'R1',
		comment: '10k',
		footprint: '0402',
		...overrides
	};
}

test('hides non-mounted BOM items from viewer-facing lists', () => {
	for (const candidate of [
		item({ comment: 'DNP' }),
		item({ description: 'Do not populate option' }),
		item({ parameters: { Fitted: 'False' } }),
		item({ parameters: { Mounted: 'No' } }),
		item({ quantity: 0 })
	]) {
		assert.equal(isNonMountedBomItem(candidate), true);
		assert.equal(shouldShowBomItemInViewer(candidate), false);
		assert.equal(bomViewerHiddenReason(candidate), 'Not mounted');
	}
});

test('hides mechanical BOM items from viewer-facing lists', () => {
	for (const candidate of [
		item({ designator: 'MH1', comment: 'Mounting hole' }),
		item({ designator: 'FID1', comment: 'Global fiducial' }),
		item({ designator: 'H1', description: 'M2 standoff' }),
		item({ designator: 'HS1', comment: 'Heat sink' }),
		item({ designator: 'BR610', comment: 'PCB_BREAKING_HOLE' })
	]) {
		assert.equal(isMechanicalBomItem(candidate), true);
		assert.equal(shouldShowBomItemInViewer(candidate), false);
		assert.equal(bomViewerHiddenReason(candidate), 'Mechanical');
	}
});

test('keeps normal electronic BOM items visible', () => {
	const resistor = item({ comment: '10k 1%', parameters: { Manufacturer: 'Yageo' } });

	assert.equal(isNonMountedBomItem(resistor), false);
	assert.equal(isMechanicalBomItem(resistor), false);
	assert.equal(shouldShowBomItemInViewer(resistor), true);
	assert.equal(bomViewerHiddenReason(resistor), '');
});
