import { isGerberFileName } from '$lib/diff/fabrication/gerberDiff';
import { normalizeAltiumJson } from '$lib/domain/adsImport';
import { validateAdsDocument } from '$lib/domain/adsValidation';
import { isOdbPackageFileName, summarizeOdbArchive } from '$lib/domain/fabrication/files';
import {
	projectStore,
	type LoadedDxfFile,
	type LoadedGerberFile,
	type LoadedJsonFile,
	type LoadedOdbFile,
	type LoadedPdfFile,
	type VersionSide
} from '$lib/state/projectStore.svelte';
import type { AltiumDoc } from '$lib/types/altium';
import { cancelJsonParsing, parseJsonOffThread } from '$lib/workers/jsonParser';

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

async function readOdbPackage(file: File) {
	return await summarizeOdbArchive(file.name, await file.arrayBuffer());
}

function yieldToRenderer() {
	return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

class ImportStore {
	importDiagnostics = $state<ImportDiagnostic[]>([]);
	loadingSide = $state<VersionSide | null>(null);
	loadingMessage = $state('');
	private importSequence: Record<VersionSide, number> = { A: 0, B: 0 };

	private validateCompatibility() {
		const files = [...projectStore.filesA, ...projectStore.filesB];
		const knownSignatures = new Set(
			files
				.map((file) => exporterSignature(file.doc))
				.filter((signature): signature is string => !!signature)
		);
		const hasUnknownExporter = files.some((file) => !exporterSignature(file.doc));

		if (projectStore.error) return;
		if (knownSignatures.size > 1) {
			projectStore.warning =
				'Les fichiers JSON ne semblent pas provenir du même exporteur .pas/schema.';
		} else if (hasUnknownExporter) {
			projectStore.warning =
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
			let pdf: LoadedPdfFile | undefined = pdfSource
				? {
						name: pdfSource.name,
						size: pdfSource.size,
						path: displayPath(pdfSource),
						url: URL.createObjectURL(pdfSource)
					}
				: undefined;
			if (
				!pdf &&
				!(side === 'A' ? projectStore.pdfA : projectStore.pdfB) &&
				window.altiumDiff?.findPdfNearJson
			) {
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
					? await Promise.all(
							odbSources.map(async (file) => ({
								name: file.name,
								size: file.size,
								path: displayPath(file),
								summary: await readOdbPackage(file)
							}))
						)
					: undefined;
			if (sequence !== this.importSequence[side]) return;
			this.loadingMessage = `Building version ${side} indexes…`;
			await yieldToRenderer();
			this.importDiagnostics = [
				...this.importDiagnostics.filter((diagnostic) => diagnostic.side !== side),
				...parsedFiles.flatMap((result) => result.diagnostics)
			];
			const existingFiles = side === 'A' ? projectStore.filesA : projectStore.filesB;
			projectStore.setFiles(
				side,
				files.length > 0 ? files : existingFiles,
				pdf,
				dxfs,
				gerbers,
				odbs
			);
			this.validateCompatibility();
			const failedCount = parsedFiles.filter((result) => !result.loaded).length;
			if (failedCount > 0) {
				projectStore.error =
					files.length > 0
						? null
						: `${failedCount} JSON file${failedCount > 1 ? 's are' : ' is'} invalid. Open diagnostics for details.`;
				if (files.length > 0)
					projectStore.warning = `${failedCount} invalid JSON file${failedCount > 1 ? 's were' : ' was'} ignored.`;
			}
		} catch (error) {
			if (sequence === this.importSequence[side])
				projectStore.error = error instanceof Error ? error.message : 'Unable to load JSON files.';
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
		projectStore.warning = `Import of version ${side} canceled.`;
	}

	reset() {
		cancelJsonParsing();
		this.importDiagnostics = [];
		this.loadingSide = null;
		this.loadingMessage = '';
		this.importSequence.A += 1;
		this.importSequence.B += 1;
	}
}

export const importStore = new ImportStore();
