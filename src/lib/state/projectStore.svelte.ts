import type {
	AltiumBomDoc,
	AltiumDoc,
	AltiumExportMeta,
	AltiumPcbDoc,
	AltiumProjectSet,
	AltiumSchSheet,
	AltiumSchematicDoc
} from '$lib/types/altium';
import { buildProjectIndex, type ComponentCategory } from '$lib/domain/project';
import { applyProjectFiles } from '$lib/domain/projectLoading';
import { validateAdsDocument } from '$lib/domain/adsValidation';
import { isGerberFileName, type GerberFile } from '$lib/diff/fabrication/gerberDiff';
import { isOdbPackageFileName, type OdbPackageFile } from '$lib/domain/fabrication/files';
import { cancelJsonParsing, parseJsonOffThread } from '$lib/workers/jsonParser';

export type VersionSide = 'A' | 'B';
export type WorkspaceTab = 'pcb' | 'schematic' | 'bom';
export type WorkspaceMode = 'compare' | 'view';

export interface LoadedJsonFile {
	name: string;
	size: number;
	path?: string;
	doc: AltiumDoc;
}

export interface LoadedPdfFile {
	name: string;
	size: number;
	path?: string;
	url: string;
}

export interface LoadedDxfFile {
	name: string;
	size: number;
	path?: string;
	text: string;
}

export type LoadedGerberFile = GerberFile;
export type LoadedOdbFile = OdbPackageFile;

export interface ImportDiagnostic {
	side: VersionSide;
	file: string;
	severity: 'info' | 'warning' | 'error';
	message: string;
}

export interface NativeProjectFile {
	name: string;
	path: string;
	size: number;
	data: Uint8Array;
}

const emptySet = (): AltiumProjectSet => ({
	bom: null,
	pcb: null,
	schematic: null
});

const docTypeToTab = (type: AltiumDoc['type']): WorkspaceTab => type;
const loadedTypes = (files: LoadedJsonFile[]) =>
	Array.from(new Set(files.map((file) => file.doc.type)));

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object') throw new Error(message);
}

function asArray<T = unknown>(value: unknown, message: string): T[] {
	if (!Array.isArray(value)) throw new Error(message);
	return value as T[];
}

function withFileMeta<T extends AltiumDoc>(
	doc: T,
	name: string,
	size: number,
	exportMeta?: AltiumExportMeta
): T {
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
		if (typeof exporterObject.scriptVersion === 'string')
			meta.scriptVersion = exporterObject.scriptVersion;
		if (typeof exporterObject.schemaVersion === 'string')
			meta.schemaVersion = exporterObject.schemaVersion;
		if (typeof exporterObject.generatedAt === 'string')
			meta.generatedAt = exporterObject.generatedAt;
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
	return [
		meta.scriptName || 'unknown-script',
		meta.scriptVersion || 'unknown-version',
		meta.schemaVersion || 'unknown-schema'
	].join('|');
}

function diagnoseDoc(side: VersionSide, file: LoadedJsonFile): ImportDiagnostic[] {
	const diagnostics: ImportDiagnostic[] = [];
	const add = (severity: ImportDiagnostic['severity'], message: string) =>
		diagnostics.push({ side, file: file.name, severity, message });
	if (!file.doc.exportMeta) add('warning', 'Exporter metadata is missing.');
	for (const validation of validateAdsDocument(file.doc))
		add(validation.severity, `${validation.path}: ${validation.message}`);
	if (file.doc.type === 'schematic') {
		if (file.doc.sheets.length === 0) add('error', 'The schematic contains no sheet.');
		const components = file.doc.sheets.reduce((sum, sheet) => sum + sheet.components.length, 0);
		if (components === 0) add('warning', 'No schematic component was exported.');
		if (file.doc.sheets.some((sheet) => sheet.wires.length > 0 && sheet.netLabels.length === 0))
			add('warning', 'Wires are present but net labels are missing on at least one sheet.');
	}
	if (file.doc.type === 'pcb') {
		if (file.doc.components.length === 0) add('warning', 'No PCB component was exported.');
		if (!file.doc.boardOutline?.length && !file.doc.boardOutlineEdges?.length)
			add('warning', 'The PCB board outline is missing.');
		if (file.doc.layers.length === 0) add('error', 'The PCB layer list is empty.');
	}
	if (file.doc.type === 'bom' && file.doc.items.length === 0) add('warning', 'The BOM is empty.');
	if (diagnostics.length === 0) add('info', 'Import validated.');
	return diagnostics;
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
				id: typeof sheet.id === 'string' ? sheet.id : undefined,
				name: typeof sheet.name === 'string' ? sheet.name : `Sheet ${index + 1}`,
				fileName: typeof sheet.fileName === 'string' ? sheet.fileName : undefined,
				path: typeof sheet.path === 'string' ? sheet.path : undefined,
				components: asArray(sheet.components, 'Schematic sheet is missing components array.'),
				wires: asArray(sheet.wires, 'Schematic sheet is missing wires array.'),
				netLabels: asArray(sheet.netLabels, 'Schematic sheet is missing netLabels array.'),
				annotations: Array.isArray(sheet.annotations) ? sheet.annotations : [],
				ports: Array.isArray(sheet.ports) ? sheet.ports : [],
				powerPorts: Array.isArray(sheet.powerPorts) ? sheet.powerPorts : [],
				offSheetConnectors: Array.isArray(sheet.offSheetConnectors) ? sheet.offSheetConnectors : [],
				sheetSymbols: Array.isArray(sheet.sheetSymbols) ? sheet.sheetSymbols : [],
				sheetEntries: Array.isArray(sheet.sheetEntries) ? sheet.sheetEntries : [],
				junctions: Array.isArray(sheet.junctions) ? sheet.junctions : [],
				noERC: Array.isArray(sheet.noERC) ? sheet.noERC : [],
				directives: Array.isArray(sheet.directives) ? sheet.directives : [],
				buses: Array.isArray(sheet.buses) ? sheet.buses : [],
				busEntries: Array.isArray(sheet.busEntries) ? sheet.busEntries : []
			} satisfies AltiumSchSheet;
		});

		return withFileMeta(
			{ type: 'schematic', fileName: name, fileSize: size, sheets },
			name,
			size,
			exportMeta
		);
	}

	const sheet = {
		name: typeof raw.name === 'string' ? raw.name : name,
		components: asArray(raw.components, 'Schematic JSON is missing components array.'),
		wires: asArray(raw.wires, 'Schematic JSON is missing wires array.'),
		netLabels: asArray(raw.netLabels, 'Schematic JSON is missing netLabels array.'),
		annotations: Array.isArray(raw.annotations) ? raw.annotations : []
	} satisfies AltiumSchSheet;

	return withFileMeta(
		{ type: 'schematic', fileName: name, fileSize: size, sheets: [sheet] },
		name,
		size,
		exportMeta
	);
}

function normalizeAltiumJsonUnchecked(parsed: unknown, name: string, size: number): AltiumDoc {
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
					boardOutlineEdges: Array.isArray(parsed.boardOutlineEdges)
						? parsed.boardOutlineEdges
						: undefined,
					boardOutlineRenderBounds:
						parsed.boardOutlineRenderBounds && typeof parsed.boardOutlineRenderBounds === 'object'
							? (parsed.boardOutlineRenderBounds as AltiumPcbDoc['boardOutlineRenderBounds'])
							: undefined,
					boardOutlineSource:
						typeof parsed.boardOutlineSource === 'string' ? parsed.boardOutlineSource : undefined,
					arcs: Array.isArray(parsed.arcs) ? parsed.arcs : undefined,
					pads: asArray(parsed.pads, 'PCB JSON is missing pads array.'),
					vias: asArray(parsed.vias, 'PCB JSON is missing vias array.'),
					polygons: Array.isArray(parsed.polygons) ? parsed.polygons : undefined,
					texts: Array.isArray(parsed.texts) ? parsed.texts : undefined,
					nets: Array.isArray(parsed.nets) ? (parsed.nets as string[]) : undefined,
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

export function normalizeAltiumJson(parsed: unknown, name: string, size: number): AltiumDoc {
	const document = normalizeAltiumJsonUnchecked(parsed, name, size);
	const errors = validateAdsDocument(document).filter((issue) => issue.severity === 'error');
	if (errors.length > 0)
		throw new Error(
			`Invalid ADS export: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}`
		);
	return document;
}

export function parseAltiumJson(text: string, name: string, size: number): AltiumDoc {
	return normalizeAltiumJson(JSON.parse(text) as unknown, name, size);
}

function getDisplayPath(file: File): string {
	const electronPath = window.altiumDiff?.getFilePath(file);
	if (electronPath) return electronPath;

	return file.webkitRelativePath || file.name;
}

async function readDxfFile(file: File) {
	return new TextDecoder('windows-1252').decode(await file.arrayBuffer());
}

async function readGerberFile(file: File) {
	return new TextDecoder('utf-8', { fatal: false }).decode(await file.arrayBuffer());
}

function yieldToRenderer() {
	return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

class ProjectStore {
	mode = $state<WorkspaceMode>('compare');
	filesA = $state<LoadedJsonFile[]>([]);
	filesB = $state<LoadedJsonFile[]>([]);
	pdfA = $state<LoadedPdfFile | null>(null);
	pdfB = $state<LoadedPdfFile | null>(null);
	dxfA = $state<LoadedDxfFile[]>([]);
	dxfB = $state<LoadedDxfFile[]>([]);
	gerberA = $state<LoadedGerberFile[]>([]);
	gerberB = $state<LoadedGerberFile[]>([]);
	odbA = $state<LoadedOdbFile[]>([]);
	odbB = $state<LoadedOdbFile[]>([]);
	projectA = $state<AltiumProjectSet>(emptySet());
	projectB = $state<AltiumProjectSet>(emptySet());
	activeTab = $state<WorkspaceTab>('pcb');
	selectedDesignator = $state<string | null>(null);
	selectedNet = $state<string | null>(null);
	searchQuery = $state('');
	componentCategory = $state<ComponentCategory>('all');
	error = $state<string | null>(null);
	warning = $state<string | null>(null);
	minimalUi = $state(true);
	importDiagnostics = $state<ImportDiagnostic[]>([]);
	loadingSide = $state<VersionSide | null>(null);
	loadingMessage = $state('');
	selectionHistory = $state<Array<{ kind: 'component' | 'net'; value: string }>>([]);
	selectionHistoryIndex = $state(-1);
	private importSequence: Record<VersionSide, number> = { A: 0, B: 0 };

	private hasLoadedSide(side: VersionSide) {
		return side === 'A'
			? this.filesA.length > 0 ||
					this.pdfA !== null ||
					this.dxfA.length > 0 ||
					this.gerberA.length > 0 ||
					this.odbA.length > 0
			: this.filesB.length > 0 ||
					this.pdfB !== null ||
					this.dxfB.length > 0 ||
					this.gerberB.length > 0 ||
					this.odbB.length > 0;
	}

	isReady = $derived.by(() =>
		this.mode === 'view' ? this.hasLoadedSide('A') : this.hasLoadedSide('A') && this.hasLoadedSide('B')
	);

	availableTabs = $derived.by<WorkspaceTab[]>(() => {
		const tabs: WorkspaceTab[] = [];
		if (this.projectA.pcb || this.projectB.pcb) tabs.push('pcb');
		if (this.projectA.schematic || this.projectB.schematic) tabs.push('schematic');
		if (this.projectA.bom || this.projectB.bom) tabs.push('bom');
		return tabs.length > 0 ? tabs : ['pcb', 'schematic', 'bom'];
	});

	indexA = $derived(buildProjectIndex(this.projectA));
	indexB = $derived(buildProjectIndex(this.projectB));
	selectedA = $derived(
		this.selectedDesignator
			? (this.indexA.byDesignator.get(this.selectedDesignator.toUpperCase()) ?? null)
			: null
	);
	selectedB = $derived(
		this.selectedDesignator
			? (this.indexB.byDesignator.get(this.selectedDesignator.toUpperCase()) ?? null)
			: null
	);

	setFiles(
		side: VersionSide,
		files: LoadedJsonFile[],
		pdf?: LoadedPdfFile | null,
		dxfs?: LoadedDxfFile[],
		gerbers?: LoadedGerberFile[],
		odbs?: LoadedOdbFile[]
	) {
		const applied = applyProjectFiles(
			{
				filesA: this.filesA,
				filesB: this.filesB,
				projectA: this.projectA,
				projectB: this.projectB
			},
			side,
			files
		);
		if (applied.error) {
			this.error = applied.error;
			return;
		}

		if (side === 'A') {
			this.filesA = applied.state.filesA;
			this.projectA = applied.state.projectA;
			if (pdf !== undefined) {
				if (this.pdfA && this.pdfA.url !== pdf?.url) URL.revokeObjectURL(this.pdfA.url);
				this.pdfA = pdf;
			}
			if (dxfs !== undefined) this.dxfA = dxfs;
			if (gerbers !== undefined) this.gerberA = gerbers;
			if (odbs !== undefined) this.odbA = odbs;
		} else {
			this.filesB = applied.state.filesB;
			this.projectB = applied.state.projectB;
			if (pdf !== undefined) {
				if (this.pdfB && this.pdfB.url !== pdf?.url) URL.revokeObjectURL(this.pdfB.url);
				this.pdfB = pdf;
			}
			if (dxfs !== undefined) this.dxfB = dxfs;
			if (gerbers !== undefined) this.gerberB = gerbers;
			if (odbs !== undefined) this.odbB = odbs;
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
		const hasUnknownExporter = [...this.filesA, ...this.filesB].some(
			(file) => !exporterSignature(file.doc)
		);

		if (knownSignatures.size > 1) {
			this.warning = 'Les fichiers JSON ne semblent pas provenir du même exporteur .pas/schema.';
		} else if (hasUnknownExporter) {
			this.warning =
				"Impossible de confirmer que tous les fichiers viennent du même .pas : au moins un JSON n'a pas de métadonnée exporter.";
		}
	}

	async loadNativeFiles(side: VersionSide, nativeFiles: NativeProjectFile[]) {
		const paths = new Map<File, string>();
		const files = nativeFiles.map((nativeFile) => {
			const extension = nativeFile.name.split('.').pop()?.toLowerCase();
			const type =
				extension === 'pdf'
					? 'application/pdf'
					: extension === 'json'
						? 'application/json'
						: isOdbPackageFileName(nativeFile.name)
							? 'application/vnd.odb++'
						: isGerberFileName(nativeFile.name)
							? 'application/vnd.gerber'
							: 'application/dxf';
			const file = new File([nativeFile.data as Uint8Array<ArrayBuffer>], nativeFile.name, {
				type
			});
			paths.set(file, nativeFile.path);
			nativeFile.data = new Uint8Array();
			return file;
		});
		await this.loadBrowserFiles(side, files, paths);
	}

	async loadBrowserFiles(
		side: VersionSide,
		fileList: FileList | File[],
		nativePaths?: Map<File, string>
	) {
		if (this.loadingSide) {
			this.importSequence[this.loadingSide] += 1;
			cancelJsonParsing('Superseded by a newer import.');
		}
		const sequence = ++this.importSequence[side];
		this.loadingSide = side;
		this.loadingMessage = `Preparing version ${side}…`;
		try {
			await yieldToRenderer();
			const inputFiles = Array.from(fileList);
			const displayPath = (file: File) => nativePaths?.get(file) ?? getDisplayPath(file);
			const jsonSources = inputFiles.filter(
				(file) =>
					file.name.toLowerCase().endsWith('.json') &&
					!file.name.toLowerCase().endsWith('_ads_manifest.json')
			);
			const parsedFiles: Array<{
				loaded: LoadedJsonFile | null;
				diagnostics: ImportDiagnostic[];
			}> = [];
			for (const [index, file] of jsonSources.entries()) {
				this.loadingMessage = `Reading ${file.name} (${index + 1}/${jsonSources.length})…`;
				await yieldToRenderer();
				try {
					const text = await file.text();
					this.loadingMessage = `Parsing ${file.name} (${index + 1}/${jsonSources.length})…`;
					await yieldToRenderer();
					const loaded: LoadedJsonFile = {
						name: file.name,
						size: file.size,
						path: displayPath(file),
						doc: normalizeAltiumJson(await parseJsonOffThread(text), file.name, file.size)
					};
					parsedFiles.push({ loaded, diagnostics: diagnoseDoc(side, loaded) });
				} catch (error) {
					parsedFiles.push({
						loaded: null,
						diagnostics: [
							{
								side,
								file: file.name,
								severity: 'error',
								message: error instanceof Error ? error.message : 'Invalid JSON export.'
							}
						]
					});
				}
				if (sequence !== this.importSequence[side]) return;
			}
			const files = parsedFiles
				.map((result) => result.loaded)
				.filter((file): file is LoadedJsonFile => file !== null);
			const pdfSource = inputFiles.find((file) => file.name.toLowerCase().endsWith('.pdf'));
			const dxfSources = inputFiles.filter((file) => file.name.toLowerCase().endsWith('.dxf'));
			const gerberSources = inputFiles.filter((file) => isGerberFileName(file.name));
			const odbSources = inputFiles.filter((file) => isOdbPackageFileName(file.name));
			let pdf = pdfSource
				? {
						name: pdfSource.name,
						size: pdfSource.size,
						path: displayPath(pdfSource),
						url: URL.createObjectURL(pdfSource)
					}
				: undefined;
			if (!pdf && !(side === 'A' ? this.pdfA : this.pdfB) && window.altiumDiff?.findPdfNearJson) {
				this.loadingMessage = 'Looking for a nearby Smart PDF…';
				await yieldToRenderer();
				const paths = inputFiles.map(displayPath).filter((path) => /^[A-Za-z]:[\\/]/.test(path));
				const discovered = await window.altiumDiff.findPdfNearJson(paths);
				if (discovered) {
					pdf = {
						name: discovered.name,
						size: discovered.size,
						path: discovered.path,
						url: URL.createObjectURL(
							new Blob([discovered.data as Uint8Array<ArrayBuffer>], {
								type: 'application/pdf'
							})
						)
					};
				}
			}
			let dxfs: LoadedDxfFile[] | undefined =
				dxfSources.length > 0
					? await Promise.all(
							dxfSources.map(async (file) => ({
								name: file.name,
								size: file.size,
								path: displayPath(file),
								text: await readDxfFile(file)
							}))
						)
					: undefined;
			if (!dxfs && window.altiumDiff?.findDxfNearJson) {
				this.loadingMessage = 'Looking for nearby DXF sheets…';
				await yieldToRenderer();
				const paths = inputFiles.map(displayPath).filter((path) => /^[A-Za-z]:[\\/]/.test(path));
				const discovered = await window.altiumDiff.findDxfNearJson(paths);
				if (discovered.length > 0) {
					const decoder = new TextDecoder('windows-1252');
					dxfs = discovered.map((file) => ({
						name: file.name,
						size: file.size,
						path: file.path,
						text: decoder.decode(file.data)
					}));
				} else if (files.length > 0) {
					dxfs = [];
				}
			}
			const gerbers: LoadedGerberFile[] | undefined =
				gerberSources.length > 0
					? await Promise.all(
							gerberSources.map(async (file) => ({
								name: file.name,
								size: file.size,
								path: displayPath(file),
								text: await readGerberFile(file)
							}))
						)
					: undefined;
			const odbs: LoadedOdbFile[] | undefined =
				odbSources.length > 0
					? odbSources.map((file) => ({
							name: file.name,
							size: file.size,
							path: displayPath(file)
						}))
					: undefined;
			if (sequence !== this.importSequence[side]) return;
			this.loadingMessage = `Building version ${side} indexes…`;
			await yieldToRenderer();
			this.importDiagnostics = [
				...this.importDiagnostics.filter((diagnostic) => diagnostic.side !== side),
				...parsedFiles.flatMap((result) => result.diagnostics)
			];
			const existingFiles = side === 'A' ? this.filesA : this.filesB;
			this.setFiles(side, files.length > 0 ? files : existingFiles, pdf, dxfs, gerbers, odbs);
			const failedCount = parsedFiles.filter((result) => !result.loaded).length;
			if (failedCount > 0) {
				this.error =
					files.length > 0
						? null
						: `${failedCount} JSON file${failedCount > 1 ? 's are' : ' is'} invalid. Open diagnostics for details.`;
				if (files.length > 0)
					this.warning = `${failedCount} invalid JSON file${failedCount > 1 ? 's were' : ' was'} ignored.`;
			}
		} catch (error) {
			if (sequence === this.importSequence[side])
				this.error = error instanceof Error ? error.message : 'Unable to load JSON files.';
		} finally {
			if (sequence === this.importSequence[side]) {
				this.loadingSide = null;
				this.loadingMessage = '';
			}
		}
	}

	cancelImport() {
		const side = this.loadingSide;
		if (!side) return;
		this.importSequence[side] += 1;
		cancelJsonParsing();
		this.loadingSide = null;
		this.loadingMessage = '';
		this.warning = `Import of version ${side} canceled.`;
	}

	selectDesignator(designator: string | null, preserveNet = false) {
		this.selectedDesignator = designator;
		if (!preserveNet) this.selectedNet = null;
		if (designator) this.rememberSelection({ kind: 'component', value: designator });
	}

	selectNet(net: string | null) {
		this.selectedNet = net;
		this.selectedDesignator = null;
		if (net) this.rememberSelection({ kind: 'net', value: net });
	}

	private rememberSelection(selection: { kind: 'component' | 'net'; value: string }) {
		const current = this.selectionHistory[this.selectionHistoryIndex];
		if (current?.kind === selection.kind && current.value === selection.value) return;
		this.selectionHistory = [
			...this.selectionHistory.slice(0, this.selectionHistoryIndex + 1),
			selection
		].slice(-60);
		this.selectionHistoryIndex = this.selectionHistory.length - 1;
	}

	get canNavigateBack() {
		return this.selectionHistoryIndex > 0;
	}

	get canNavigateForward() {
		return (
			this.selectionHistoryIndex >= 0 &&
			this.selectionHistoryIndex < this.selectionHistory.length - 1
		);
	}

	navigateSelection(direction: -1 | 1) {
		const nextIndex = this.selectionHistoryIndex + direction;
		const selection = this.selectionHistory[nextIndex];
		if (!selection) return;
		this.selectionHistoryIndex = nextIndex;
		this.selectedDesignator = selection.kind === 'component' ? selection.value : null;
		this.selectedNet = selection.kind === 'net' ? selection.value : null;
	}

	setMode(mode: WorkspaceMode) {
		this.reset();
		this.mode = mode;
	}

	reset() {
		cancelJsonParsing();
		if (this.pdfA) URL.revokeObjectURL(this.pdfA.url);
		if (this.pdfB) URL.revokeObjectURL(this.pdfB.url);
		this.filesA = [];
		this.filesB = [];
		this.pdfA = null;
		this.pdfB = null;
		this.dxfA = [];
		this.dxfB = [];
		this.gerberA = [];
		this.gerberB = [];
		this.odbA = [];
		this.odbB = [];
		this.projectA = emptySet();
		this.projectB = emptySet();
		this.selectedDesignator = null;
		this.selectedNet = null;
		this.searchQuery = '';
		this.componentCategory = 'all';
		this.error = null;
		this.warning = null;
		this.importDiagnostics = [];
		this.loadingSide = null;
		this.loadingMessage = '';
		this.importSequence.A += 1;
		this.importSequence.B += 1;
		this.selectionHistory = [];
		this.selectionHistoryIndex = -1;
	}
}

export const projectStore = new ProjectStore();
