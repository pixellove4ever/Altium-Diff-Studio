import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const example = (name: string) =>
	readFileSync(new URL(`../altium-scripts/examples/${name}`, import.meta.url), 'utf8');

test('keeps every canonical minimal ADS document valid and versioned', () => {
	const cases = [
		['minimal-pcb.json', 'pcb', 'ads-json-pcb-v2'],
		['minimal-schematic.json', 'schematic', 'ads-json-sch-v2'],
		['minimal-bom.json', 'bom', 'ads-json-bom-v1']
	] as const;

	for (const [name, type, schemaVersion] of cases) {
		const document = JSON.parse(example(name)) as Record<string, unknown>;
		assert.equal(document.type, type);
		assert.equal(document.schemaVersion, schemaVersion);
		if (type === 'pcb') {
			for (const container of ['components', 'tracks', 'pads', 'vias', 'layers'])
				assert.ok(Array.isArray(document[container]), `${name}: ${container}`);
		} else if (type === 'schematic') {
			assert.ok(Array.isArray(document.sheets));
			const sheet = (document.sheets as Array<Record<string, unknown>>)[0];
			for (const container of ['components', 'wires', 'netLabels'])
				assert.ok(Array.isArray(sheet[container]), `${name}: ${container}`);
		} else {
			assert.ok(Array.isArray(document.items));
		}
	}
});

test('documents a distinct schema major for each ADS document type', () => {
	const versions = ['minimal-pcb.json', 'minimal-schematic.json', 'minimal-bom.json'].map(
		(name) => (JSON.parse(example(name)) as { schemaVersion: string }).schemaVersion
	);
	assert.equal(new Set(versions).size, 3);
	assert.ok(versions.every((version) => /^ads-json-(?:pcb|sch|bom)-v\d+$/.test(version)));
});
