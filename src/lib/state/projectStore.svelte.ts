import type {
	AltiumBomDoc,
	AltiumDoc,
	AltiumExportMeta,
	AltiumPcbDoc,
	AltiumProjectSet,
	AltiumSchSheet,
	AltiumSchematicDoc
} from '$lib/types/altium';

export type VersionSide = 'A' | 'B';
export type WorkspaceTab = 'pcb' | 'schematic' | 'bom';

export interface LoadedJsonFile {
	name: string;
	size: number;
	path?: string;
	doc: AltiumDoc;
}

const emptySet = (): AltiumProjectSet => ({
	bom: null,
	pcb: null,
	schematic: null
});

const docTypeToTab = (type: AltiumDoc['type']): WorkspaceTab => type;
const loadedTypes = (files: LoadedJsonFile[]) => Array.from(new Set(files.map((file) => file.doc.type)));

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object') throw new Error(message);
}

function asArray<T = unknown>(value: unknown, message: string): T[] {
	if (!Array.isArray(value)) throw new Error(message);
	return value as T[];
}

function withFileMeta<T extends AltiumDoc>(doc: T, name: string, size: number, exportMeta?: AltiumExportMeta): T {
	return {
		...doc,
		fileName: name,
		fileSize: size,
		exportMeta
	};
}

function readExportMeta(raw: Record<string, unknown>): AltiumExportMeta | undefined {
	const exporter = raw.exporter;
	const meta: AltiumExportMeta = {};

	if (exporter && typeof exporter === 'object') {
		const exporterObject = exporter as Record<string, unknown>;
		if (typeof exporterObject.scriptName === 'string') meta.scriptName = exporterObject.scriptName;
		if (typeof exporterObject.scriptVersion === 'string') meta.scriptVersion = exporterObject.scriptVersion;
		if (typeof exporterObject.schemaVersion === 'string') meta.schemaVersion = exporterObject.schemaVersion;
		if (typeof exporterObject.generatedAt === 'string') meta.generatedAt = exporterObject.generatedAt;
	}

	if (typeof raw.scriptName === 'string') meta.scriptName = raw.scriptName;
	if (typeof raw.scriptVersion === 'string') meta.scriptVersion = raw.scriptVersion;
	if (typeof raw.schemaVersion === 'string') meta.schemaVersion = raw.schemaVersion;
	if (typeof raw.generatedAt === 'string') meta.generatedAt = raw.generatedAt;

	return Object.keys(meta).length > 0 ? meta : undefined;
}

function exporterSignature(doc: AltiumDoc) {
	const meta = doc.exportMeta;
	if (!meta) return null;
	return [meta.scriptName || 'unknown-script', meta.scriptVersion || 'unknown-version', meta.schemaVersion || 'unknown-schema'].join('|');
}

function normalizeSchematic(
	raw: Record<string, unknown>,
	name: string,
	size: number,
	exportMeta?: AltiumExportMeta
): AltiumSchematicDoc {
	if (Array.isArray(raw.sheets)) {
		const sheets = raw.sheets.map((sheet, index) => {
			assertObject(sheet, `Invalid schematic sheet at index ${index}.`);

			return {
				name: typeof sheet.name === 'string' ? sheet.name : `Sheet ${index + 1}`,
				fileName: typeof sheet.fileName === 'string' ? sheet.fileName : undefined,
				components: asArray(sheet.components, 'Schematic sheet is missing components array.'),
				wires: asArray(sheet.wires, 'Schematic sheet is missing wires array.'),
				netLabels: asArray(sheet.netLabels, 'Schematic sheet is missing netLabels array.')
			} satisfies AltiumSchSheet;
		});

		return withFileMeta({ type: 'schematic', fileName: name, fileSize: size, sheets }, name, size, exportMeta);
	}

	const sheet = {
		name: typeof raw.name === 'string' ? raw.name : name,
		components: asArray(raw.components, 'Schematic JSON is missing components array.'),
		wires: asArray(raw.wires, 'Schematic JSON is missing wires array.'),
		netLabels: asArray(raw.netLabels, 'Schematic JSON is missing netLabels array.')
	} satisfies AltiumSchSheet;

	return withFileMeta({ type: 'schematic', fileName: name, fileSize: size, sheets: [sheet] }, name, size, exportMeta);
}

export function parseAltiumJson(text: string, name: string, size: number): AltiumDoc {
	const parsed: unknown = JSON.parse(text);
	assertObject(parsed, `${name} is not a JSON object.`);
	const exportMeta = readExportMeta(parsed);

	switch (parsed.type) {
		case 'bom':
			return withFileMeta(
				{
					type: 'bom',
					fileName: name,
					fileSize: size,
					items: asArray(parsed.items, 'BOM JSON is missing items array.')
				} satisfies AltiumBomDoc,
				name,
				size,
				exportMeta
			);
		case 'pcb':
			return withFileMeta(
				{
					type: 'pcb',
					fileName: name,
					fileSize: size,
					components: asArray(parsed.components, 'PCB JSON is missing components array.'),
					tracks: asArray(parsed.tracks, 'PCB JSON is missing tracks array.'),
					boardOutline: Array.isArray(parsed.boardOutline) ? parsed.boardOutline : undefined,
					arcs: Array.isArray(parsed.arcs) ? parsed.arcs : undefined,
					pads: asArray(parsed.pads, 'PCB JSON is missing pads array.'),
					vias: asArray(parsed.vias, 'PCB JSON is missing vias array.'),
					polygons: Array.isArray(parsed.polygons) ? parsed.polygons : undefined,
					texts: Array.isArray(parsed.texts) ? parsed.texts : undefined,
					layers: asArray<string>(parsed.layers, 'PCB JSON is missing layers array.')
				} satisfies AltiumPcbDoc,
				name,
				size,
				exportMeta
			);
		case 'schematic':
			return normalizeSchematic(parsed, name, size, exportMeta);
		default:
			throw new Error(`${name} has unsupported or missing type. Expected bom, pcb, or schematic.`);
	}
}

function getDisplayPath(file: File): string {
	const electronPath = window.altiumDiff?.getFilePath(file);
	if (electronPath) return electronPath;

	return file.webkitRelativePath || file.name;
}

class ProjectStore {
	filesA = $state<LoadedJsonFile[]>([]);
	filesB = $state<LoadedJsonFile[]>([]);
	projectA = $state<AltiumProjectSet>(emptySet());
	projectB = $state<AltiumProjectSet>(emptySet());
	activeTab = $state<WorkspaceTab>('pcb');
	selectedDesignator = $state<string | null>(null);
	error = $state<string | null>(null);
	warning = $state<string | null>(null);

	isReady = $derived.by(() => this.filesA.length > 0 && this.filesB.length > 0);

	availableTabs = $derived.by<WorkspaceTab[]>(() => {
		const tabs: WorkspaceTab[] = [];
		if (this.projectA.pcb || this.projectB.pcb) tabs.push('pcb');
		if (this.projectA.schematic || this.projectB.schematic) tabs.push('schematic');
		if (this.projectA.bom || this.projectB.bom) tabs.push('bom');
		return tabs.length > 0 ? tabs : ['pcb', 'schematic', 'bom'];
	});

	setFiles(side: VersionSide, files: LoadedJsonFile[]) {
		const targetSet = emptySet();
		const otherFiles = side === 'A' ? this.filesB : this.filesA;
		const newTypes = loadedTypes(files);
		const otherTypes = loadedTypes(otherFiles);

		if (newTypes.length > 0 && otherTypes.length > 0) {
			const hasCompatibleType = newTypes.some((type) => otherTypes.includes(type));

			if (!hasCompatibleType) {
				this.error = `Types incompatibles : impossible de comparer ${newTypes.join(', ').toUpperCase()} en version ${side} avec ${otherTypes.join(', ').toUpperCase()} dans l'autre version. Chargez au moins un même type de fichier des deux côtés.`;
				return;
			}
		}

		for (const file of files) {
			targetSet[file.doc.type] = file.doc as never;
		}

		if (side === 'A') {
			this.filesA = files;
			this.projectA = targetSet;
		} else {
			this.filesB = files;
			this.projectB = targetSet;
		}

		if (files.length > 0) {
			this.activeTab = docTypeToTab(files[0].doc.type);
		}

		this.validateCompatibility();
	}

	validateCompatibility() {
		const typesA = loadedTypes(this.filesA);
		const typesB = loadedTypes(this.filesB);
		if (typesA.length === 0 || typesB.length === 0) {
			this.error = null;
			return;
		}

		const hasCompatibleType = typesA.some((type) => typesB.includes(type));
		this.error = hasCompatibleType
			? null
			: `Types incompatibles : version A contient ${typesA.join(', ').toUpperCase()} et version B contient ${typesB.join(', ').toUpperCase()}.`;

		this.warning = null;
		if (this.error) return;

		const knownSignatures = new Set(
			[...this.filesA, ...this.filesB]
				.map((file) => exporterSignature(file.doc))
				.filter((signature): signature is string => !!signature)
		);
		const hasUnknownExporter = [...this.filesA, ...this.filesB].some((file) => !exporterSignature(file.doc));

		if (knownSignatures.size > 1) {
			this.warning = 'Les fichiers JSON ne semblent pas provenir du même exporteur .pas/schema.';
		} else if (hasUnknownExporter) {
			this.warning = "Impossible de confirmer que tous les fichiers viennent du même .pas : au moins un JSON n'a pas de métadonnée exporter.";
		}
	}

	async loadBrowserFiles(side: VersionSide, fileList: FileList | File[]) {
		try {
			const files = await Promise.all(
				Array.from(fileList)
					.filter((file) => file.name.toLowerCase().endsWith('.json'))
					.map(async (file) => ({
						name: file.name,
						size: file.size,
						path: getDisplayPath(file),
						doc: parseAltiumJson(await file.text(), file.name, file.size)
					}))
			);

			this.setFiles(side, files);
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Unable to load JSON files.';
		}
	}

	selectDesignator(designator: string | null) {
		this.selectedDesignator = designator;
	}

	reset() {
		this.filesA = [];
		this.filesB = [];
		this.projectA = emptySet();
		this.projectB = emptySet();
		this.selectedDesignator = null;
		this.error = null;
		this.warning = null;
	}
}

export const projectStore = new ProjectStore();
