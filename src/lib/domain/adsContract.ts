import type { AltiumDoc } from '../types/altium.ts';

export type AdsDocumentType = AltiumDoc['type'];
export type AdsContractCapability = 'designData' | 'netlistData' | 'graphicalEnrichment';
export type AdsSplitContract = 'design' | 'netlist' | 'graphics';

export interface AdsContractEntry {
	type: AdsDocumentType;
	schemaVersion: string;
	capabilities: AdsContractCapability[];
}

export interface AdsSplitContractEntry {
	contract: AdsSplitContract;
	capabilities: AdsContractCapability[];
	required: boolean;
	description: string;
}

export interface AdsSplitMigrationPlan {
	type: AdsDocumentType;
	fromSchemaVersion: string;
	targets: AdsSplitContractEntry[];
	lossless: boolean;
	message: string;
}

export interface AdsSplitContractDefinition {
	contract: AdsSplitContract;
	capabilities: AdsContractCapability[];
	description: string;
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

export const ADS_SPLIT_CONTRACTS: Record<AdsSplitContract, AdsSplitContractDefinition> = {
	design: {
		contract: 'design',
		capabilities: ['designData'],
		description:
			'Components, placements, parameters and document objects needed to inspect a design.'
	},
	netlist: {
		contract: 'netlist',
		capabilities: ['netlistData'],
		description: 'Logical connectivity, net names and topology data needed for semantic comparison.'
	},
	graphics: {
		contract: 'graphics',
		capabilities: ['graphicalEnrichment'],
		description: 'Sheet and board drawing hints used to render documents faithfully.'
	}
};

const splitContractByCapability: Record<AdsContractCapability, AdsSplitContract> = {
	designData: 'design',
	netlistData: 'netlist',
	graphicalEnrichment: 'graphics'
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

export function adsSplitContractFor(contract: AdsSplitContract) {
	return ADS_SPLIT_CONTRACTS[contract];
}

export function adsSplitContractsFor(type: AdsDocumentType): AdsSplitContractEntry[] {
	return adsContractFor(type).capabilities.map((capability) => {
		const splitContract = adsSplitContractFor(splitContractByCapability[capability]);
		return {
			contract: splitContract.contract,
			capabilities: splitContract.capabilities,
			required: capability === 'designData',
			description: splitContract.description
		};
	});
}

export function adsSplitMigrationPlan(type: AdsDocumentType): AdsSplitMigrationPlan {
	const contract = adsContractFor(type);
	const targets = adsSplitContractsFor(type);
	const presentTargets = new Set(targets.map((target) => target.contract));
	const expectedTargets: AdsSplitContract[] =
		type === 'bom' ? ['design'] : ['design', 'netlist', 'graphics'];
	const missingTargets = expectedTargets.filter((target) => !presentTargets.has(target));
	const lossless = missingTargets.length === 0;

	return {
		type,
		fromSchemaVersion: contract.schemaVersion,
		targets,
		lossless,
		message: lossless
			? `${contract.schemaVersion} can be split into ${targets.map((target) => target.contract).join(', ')} contracts without dropping declared capabilities.`
			: `${contract.schemaVersion} only declares ${targets.map((target) => target.contract).join(', ')} contracts; ${missingTargets.join(', ')} would remain absent.`
	};
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
