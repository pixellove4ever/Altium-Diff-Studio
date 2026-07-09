import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	ADS_CONTRACT,
	adsContractFor,
	adsSchemaCompatibility
} from '../src/lib/domain/adsContract.ts';

const versions = JSON.parse(readFileSync(new URL('../versions.json', import.meta.url), 'utf8')) as {
	schemas: Record<'pcb' | 'schematic' | 'bom', string>;
};

test('keeps ADS contract schema versions synchronized with the version matrix', () => {
	assert.equal(adsContractFor('pcb').schemaVersion, versions.schemas.pcb);
	assert.equal(adsContractFor('schematic').schemaVersion, versions.schemas.schematic);
	assert.equal(adsContractFor('bom').schemaVersion, versions.schemas.bom);
});

test('separates current ADS contract capabilities by document role', () => {
	assert.deepEqual(ADS_CONTRACT.pcb.capabilities, [
		'designData',
		'netlistData',
		'graphicalEnrichment'
	]);
	assert.deepEqual(ADS_CONTRACT.schematic.capabilities, [
		'designData',
		'netlistData',
		'graphicalEnrichment'
	]);
	assert.deepEqual(ADS_CONTRACT.bom.capabilities, ['designData']);
});

test('classifies ADS schema compatibility for migration diagnostics', () => {
	assert.equal(adsSchemaCompatibility('schematic', 'ads-json-sch-v2').status, 'compatible');
	assert.equal(adsSchemaCompatibility('schematic', undefined).status, 'legacy');
	assert.equal(adsSchemaCompatibility('schematic', 'ads-json-sch-v3').status, 'migration-required');
	assert.equal(adsSchemaCompatibility('schematic', 'ads-json-pcb-v2').status, 'unsupported');
	assert.equal(adsSchemaCompatibility('schematic', 'v2').status, 'unsupported');
});
