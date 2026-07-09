import type { AltiumBomItem } from '$lib/types/altium';

const negativeValues = new Set([
	'0',
	'false',
	'no',
	'n',
	'not fitted',
	'not mounted',
	'dnp',
	'dni'
]);

function normalizedValues(item: AltiumBomItem) {
	return [
		item.designator,
		item.comment,
		item.footprint,
		item.description,
		item.libRef,
		...Object.entries(item.parameters ?? {}).flat()
	]
		.filter((value) => value !== undefined && value !== null)
		.map((value) =>
			String(value)
				.toLowerCase()
				.replace(/[._-]+/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
		)
		.filter(Boolean);
}

function parameterValue(item: AltiumBomItem, patterns: RegExp[]) {
	for (const [key, value] of Object.entries(item.parameters ?? {})) {
		if (!patterns.some((pattern) => pattern.test(key))) continue;
		const normalized = String(value ?? '')
			.toLowerCase()
			.replace(/[._-]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (normalized) return normalized;
	}
	return '';
}

export function isNonMountedBomItem(item: AltiumBomItem) {
	if (item.quantity !== undefined && item.quantity <= 0) return true;
	const fittedValue = parameterValue(item, [
		/^fitted$/i,
		/^mounted$/i,
		/^populated$/i,
		/^populate$/i,
		/^assembly$/i,
		/^include\s*in\s*bom$/i
	]);
	if (negativeValues.has(fittedValue)) return true;
	return normalizedValues(item).some((text) =>
		/\b(dnp|dni|dnm|n\/m|no fit|nofit|no load|not fitted|not mounted|not populated|not assembled|not installed|do not fit|do not populate|unpopulated)\b/.test(
			text
		)
	);
}

export function isMechanicalBomItem(item: AltiumBomItem) {
	const prefix = item.designator.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
	const text = normalizedValues(item).join(' ');
	const mechanicalText =
		/\b(mechanical|mounting hole|mount hole|standoff|stand off|screw|washer|nut|spacer|heatsink|heat sink|enclosure|chassis|fiducial)\b/.test(
			text
		);
	if (mechanicalText) return true;
	return ['MH', 'FID'].includes(prefix);
}

export function shouldShowBomItemInViewer(item: AltiumBomItem | undefined) {
	if (!item) return true;
	return !isNonMountedBomItem(item) && !isMechanicalBomItem(item);
}
