import type { AltiumDoc } from '../types/altium.ts';

export type AdsDocumentType = AltiumDoc['type'];
export type AdsContractCapability = 'designData' | 'netlistData' | 'graphicalEnrichment';

export interface AdsContractEntry {
	type: AdsDocumentType;
	schemaVersion: string;
	capabilities: AdsContractCapability[];
}

export type AdsSchemaCompatibility =
	| { status: 'compatible'; message: string }
	| { status: 'legacy'; message: string }
	| { status: 'migration-required'; message: string }
	| { status: 'unsupported'; message: string };

export const ADS_CONTRACT: Record<AdsDocumentType, AdsContractEntry> = {
	pcb: {
		type: 'pcb',
		schemaVersion: 'ads-json-pcb-v2',
		capabilities: ['designData', 'netlistData', 'graphicalEnrichment']
	},
	schematic: {
		type: 'schematic',
		schemaVersion: 'ads-json-sch-v2',
		capabilities: ['designData', 'netlistData', 'graphicalEnrichment']
	},
	bom: {
		type: 'bom',
		schemaVersion: 'ads-json-bom-v1',
		capabilities: ['designData']
	}
};

const schemaPattern = /^ads-json-(pcb|sch|bom)-v(\d+)$/;
const schemaTypeAlias: Record<string, AdsDocumentType> = {
	pcb: 'pcb',
	sch: 'schematic',
	bom: 'bom'
};

function parseSchemaVersion(schemaVersion: string) {
	const match = schemaVersion.match(schemaPattern);
	if (!match) return null;
	return {
		type: schemaTypeAlias[match[1]],
		major: Number.parseInt(match[2], 10)
	};
}

export function adsContractFor(type: AdsDocumentType) {
	return ADS_CONTRACT[type];
}

export function adsSchemaCompatibility(
	type: AdsDocumentType,
	schemaVersion: string | undefined
): AdsSchemaCompatibility {
	const expected = adsContractFor(type);
	if (!schemaVersion?.trim()) {
		return {
			status: 'legacy',
			message: `Missing schemaVersion; ${type} import is accepted in legacy mode.`
		};
	}

	const actual = parseSchemaVersion(schemaVersion);
	const expectedSchema = parseSchemaVersion(expected.schemaVersion);
	if (!actual || !expectedSchema) {
		return {
			status: 'unsupported',
			message: `Unsupported schemaVersion "${schemaVersion}" for ${type}; expected ${expected.schemaVersion}.`
		};
	}
	if (actual.type !== type) {
		return {
			status: 'unsupported',
			message: `SchemaVersion "${schemaVersion}" is for ${actual.type}, not ${type}.`
		};
	}
	if (actual.major !== expectedSchema.major) {
		return {
			status: 'migration-required',
			message: `SchemaVersion "${schemaVersion}" requires migration to ${expected.schemaVersion}.`
		};
	}

	return {
		status: 'compatible',
		message: `SchemaVersion "${schemaVersion}" is compatible with ${expected.schemaVersion}.`
	};
}
