import type { BomDiffRow } from '$lib/diff/altiumDiff';
import type { AltiumBomItem } from '$lib/types/altium';
import { translate, type Locale } from '../i18n.ts';

export type BomDiffExportSource = {
	name: string;
	schemaVersion?: string;
};

export type BomDiffExportOptions = {
	rows: BomDiffRow[];
	appVersion: string;
	locale: Locale;
	generatedAt: string;
	sourceA: BomDiffExportSource;
	sourceB: BomDiffExportSource;
	scope: 'complete' | 'filtered';
};

function safeSpreadsheetValue(value: unknown) {
	const text = value === undefined || value === null ? '' : String(value);
	return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown) {
	const text = safeSpreadsheetValue(value);
	return `"${text.replaceAll('"', '""')}"`;
}

function itemValue(item: AltiumBomItem | null, field: keyof AltiumBomItem) {
	const value = item?.[field];
	return value && typeof value === 'object'
		? Object.entries(value)
				.map(([key, entry]) => `${key}=${entry}`)
				.join(' | ')
		: (value ?? '');
}

const line = (values: unknown[]) => values.map(csvCell).join(';');

export function createBomDiffCsv(options: BomDiffExportOptions) {
	const columns = [
		translate(options.locale, 'common.status'),
		translate(options.locale, 'common.designator'),
		'Comment A',
		'Comment B',
		'Footprint A',
		'Footprint B',
		'Description A',
		'Description B',
		'Library A',
		'Library B',
		'Quantity A',
		'Quantity B',
		'Parameters A',
		'Parameters B',
		'Changed fields',
		'Change details'
	];
	const rows = options.rows.map((row) =>
		line([
			row.status,
			row.designator,
			itemValue(row.before, 'comment'),
			itemValue(row.after, 'comment'),
			itemValue(row.before, 'footprint'),
			itemValue(row.after, 'footprint'),
			itemValue(row.before, 'description'),
			itemValue(row.after, 'description'),
			itemValue(row.before, 'libRef'),
			itemValue(row.after, 'libRef'),
			itemValue(row.before, 'quantity'),
			itemValue(row.after, 'quantity'),
			itemValue(row.before, 'parameters'),
			itemValue(row.after, 'parameters'),
			row.changes.map((change) => change.field).join(', '),
			row.changes.map((change) => `${change.field}: ${change.from} → ${change.to}`).join(' | ')
		])
	);

	return [
		'\uFEFFsep=;',
		line(['Report', 'Altium Diff Studio BOM differences']),
		line([
			translate(options.locale, 'common.application'),
			`Altium Diff Studio ${options.appVersion}`
		]),
		line([translate(options.locale, 'common.scope'), options.scope]),
		line(['Generated at', options.generatedAt]),
		line(['Version A', options.sourceA.name, options.sourceA.schemaVersion ?? 'unknown']),
		line(['Version B', options.sourceB.name, options.sourceB.schemaVersion ?? 'unknown']),
		'',
		line(columns),
		...rows
	].join('\r\n');
}
