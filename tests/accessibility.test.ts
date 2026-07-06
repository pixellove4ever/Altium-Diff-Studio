import assert from 'node:assert/strict';
import test from 'node:test';
import { diffColors } from '../src/lib/diff/altiumDiff.ts';

function luminance(hex: string) {
	const channels = hex
		.slice(1)
		.match(/.{2}/g)!
		.map((value) => Number.parseInt(value, 16) / 255)
		.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
	return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test('keeps diff status colors at WCAG AA contrast against white', () => {
	const white = luminance('#ffffff');
	for (const [status, color] of Object.entries(diffColors)) {
		const ratio = (white + 0.05) / (luminance(color) + 0.05);
		assert.ok(ratio >= 4.5, `${status} contrast is ${ratio.toFixed(2)}:1`);
	}
});
