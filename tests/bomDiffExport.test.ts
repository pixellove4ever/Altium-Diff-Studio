import assert from 'node:assert/strict';
import test from 'node:test';
import { createBomDiffCsv } from '../src/lib/domain/bomDiffExport.ts';

test('exports BOM differences with metadata and A/B values', () => {
	const csv = createBomDiffCsv({
		appVersion: '0.0.1',
		locale: 'en',
		generatedAt: '2026-07-06T08:00:00.000Z',
		scope: 'filtered',
		sourceA: { name: 'baseline_bom.json', schemaVersion: 'ads-json-bom-v1' },
		sourceB: { name: 'candidate_bom.json', schemaVersion: 'ads-json-bom-v1' },
		rows: [
			{
				designator: 'R1',
				status: 'modified',
				before: { designator: 'R1', comment: '10k', footprint: '0402' },
				after: { designator: 'R1', comment: '22k', footprint: '0402' },
				changes: [{ field: 'Comment', from: '10k', to: '22k' }]
			}
		]
	});

	assert.ok(csv.startsWith('\uFEFFsep=;\r\n'));
	assert.match(csv, /"Application";"Altium Diff Studio 0\.0\.1"/);
	assert.match(csv, /"Version A";"baseline_bom\.json";"ads-json-bom-v1"/);
	assert.match(csv, /"modified";"R1";"10k";"22k"/);
	assert.match(csv, /"Comment: 10k → 22k"/);
});

test('escapes CSV quotes and neutralizes spreadsheet formulas', () => {
	const csv = createBomDiffCsv({
		appVersion: '0.0.1',
		locale: 'en',
		generatedAt: '2026-07-06',
		scope: 'complete',
		sourceA: { name: 'A' },
		sourceB: { name: 'B' },
		rows: [
			{
				designator: '=HYPERLINK("bad")',
				status: 'added',
				before: null,
				after: { designator: 'X', comment: 'say "hello"', footprint: 'X' },
				changes: []
			}
		]
	});

	assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
	assert.match(csv, /"say ""hello"""/);
});
