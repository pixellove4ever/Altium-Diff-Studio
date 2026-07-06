import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootFile = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('keeps application, exporter, schemas and review session versions synchronized', () => {
	const versions = JSON.parse(rootFile('versions.json')) as {
		application: string;
		exporter: string;
		schemas: { pcb: string; schematic: string; bom: string };
		reviewSession: number;
	};
	const packageJson = JSON.parse(rootFile('package.json')) as { version: string };
	const exporter = rootFile('altium-scripts/ExportDesignData_ADS.pas');
	const reviewSession = rootFile('src/lib/domain/reviewSession.ts');

	assert.equal(packageJson.version, versions.application);
	for (const [constant, expected] of [
		['SCRIPT_VERSION', versions.exporter],
		['PCB_SCHEMA_VERSION', versions.schemas.pcb],
		['SCHEMATIC_SCHEMA_VERSION', versions.schemas.schematic],
		['BOM_SCHEMA_VERSION', versions.schemas.bom]
	] as const) {
		assert.match(exporter, new RegExp(`${constant} = '${expected.replaceAll('.', '\\.')}';`));
	}
	assert.match(reviewSession, new RegExp(`version: ${versions.reviewSession};`));
});

test('keeps minimal ADS examples aligned with the version matrix', () => {
	const versions = JSON.parse(rootFile('versions.json')) as {
		schemas: Record<'pcb' | 'schematic' | 'bom', string>;
	};
	for (const [type, file] of [
		['pcb', 'minimal-pcb.json'],
		['schematic', 'minimal-schematic.json'],
		['bom', 'minimal-bom.json']
	] as const) {
		const example = JSON.parse(rootFile(`altium-scripts/examples/${file}`)) as {
			schemaVersion: string;
		};
		assert.equal(example.schemaVersion, versions.schemas[type]);
	}
});
