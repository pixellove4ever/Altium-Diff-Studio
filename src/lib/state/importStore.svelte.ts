import { isGerberFileName } from '$lib/diff/fabrication/gerberDiff';
import { adsSchemaCompatibility } from '$lib/domain/adsContract';
import { normalizeAltiumJson } from '$lib/domain/adsImport';
import { validateAdsDocument } from '$lib/domain/adsValidation';
import { isOdbPackageFileName, summarizeOdbArchive } from '$lib/domain/fabrication/files';
import { exporterCompatibilityWarning } from '$lib/domain/projectLoading';
import {
	readBlobBufferInChunks,
	readBlobTextInChunks,
	type ChunkedBlobReadOptions
} from '$lib/domain/fileRead';
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

async function readDxfFile(file: File, options?: ChunkedBlobReadOptions) {
	return await readBlobTextInChunks(file, { ...options, encoding: 'windows-1252' });
}

async function readGerberFile(file: File, options?: ChunkedBlobReadOptions) {
	return await readBlobTextInChunks(file, { ...options, encoding: 'utf-8' });
}

async function readOdbPackage(file: File, options?: Omit<ChunkedBlobReadOptions, 'encoding'>) {
	return await summarizeOdbArchive(file.name, await readBlobBufferInChunks(file, options));
}

function yieldToRenderer() {
	return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function formatByteProgress(loadedBytes: number, totalBytes: number) {
	if (totalBytes <= 0) return '0%';
	return `${Math.min(100, Math.round((loadedBytes / totalBytes) * 100))}%`;
}

function diagnoseDoc(side: VersionSide, file: LoadedJsonFile): ImportDiagnostic[] {
	const diagnostics: ImportDiagnostic[] = [];
	const add = (severity: ImportDiagnostic['severity'], message: string) =>
		diagnostics.push({ side, file: file.name, severity, message });
	if (!file.doc.exportMeta) add('warning', 'Exporter metadata is missing.');
	const schema = adsSchemaCompatibility(file.doc.type, file.doc.exportMeta?.schemaVersion);
	if (schema.status === 'legacy') add('warning', schema.message);
	else if (schema.status === 'migration-required' || schema.status === 'unsupported')
		add('error', schema.message);
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

function diagnoseDocumentSet(side: VersionSide, files: LoadedJsonFile[]): ImportDiagnostic[] {
	const diagnostics: ImportDiagnostic[] = [];
	const byType = new Map<AltiumDoc['type'], LoadedJsonFile[]>();
	for (const file of files) {
		const entries = byType.get(file.doc.type) ?? [];
		entries.push(file);
		byType.set(file.doc.type, entries);
	}
	for (const [type, entries] of byType) {
		if (entries.length <= 1) continue;
		diagnostics.push({
			side,
			file: entries.map((entry) => entry.name).join(', '),
			severity: 'warning',
			message: `Multiple ${type.toUpperCase()} JSON files were loaded for version ${side}; the last one in import order is used as the active ${type.toUpperCase()} document.`
		});
	}
	return diagnostics;
}

class ImportStore {
	importDiagnostics = $state<ImportDiagnostic[]>([]);
	loadingSide = $state<VersionSide | null>(null);
	loadingMessage = $state('');
	private importSequence: Record<VersionSide, number> = { A: 0, B: 0 };

	private validateCompatibility() {
		const files = [...projectStore.filesA, ...projectStore.filesB];
		if (projectStore.error) return;
		projectStore.warning = exporterCompatibilityWarning(files);
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
			const isCanceled = () => sequence !== this.importSequence[side];
			const displayPath = (file: File) => nativePaths?.get(file) ?? getDisplayPath(file);
			const readOptions = (action: string, file: File, index: number, total: number) => ({
				isCanceled,
				onProgress: (loadedBytes: number, totalBytes: number) => {
					this.loadingMessage = `${action} ${file.name} (${index + 1}/${total}, ${formatByteProgress(
						loadedBytes,
						totalBytes
					)})â€¦`;
				}
			});
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
					const text = await readBlobTextInChunks(
						file,
						readOptions('Reading', file, index, jsonSources.length)
					);
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
			let dxfs: LoadedDxfFile[] | undefined;
			if (dxfSources.length > 0) {
				dxfs = [];
				for (const [index, file] of dxfSources.entries()) {
					dxfs.push({
						name: file.name,
						size: file.size,
						path: displayPath(file),
						text: await readDxfFile(
							file,
							readOptions('Reading DXF', file, index, dxfSources.length)
						)
					});
					if (isCanceled()) return;
				}
			}
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
			let gerbers: LoadedGerberFile[] | undefined;
			if (gerberSources.length > 0) {
				gerbers = [];
				for (const [index, file] of gerberSources.entries()) {
					gerbers.push({
						name: file.name,
						size: file.size,
						path: displayPath(file),
						text: await readGerberFile(
							file,
							readOptions('Reading Gerber', file, index, gerberSources.length)
						)
					});
					if (isCanceled()) return;
				}
			}
			let odbs: LoadedOdbFile[] | undefined;
			if (odbSources.length > 0) {
				odbs = [];
				for (const [index, file] of odbSources.entries()) {
					odbs.push({
						name: file.name,
						size: file.size,
						path: displayPath(file),
						summary: await readOdbPackage(
							file,
							readOptions('Reading ODB++', file, index, odbSources.length)
						)
					});
					if (isCanceled()) return;
				}
			}
			if (sequence !== this.importSequence[side]) return;
			this.loadingMessage = `Building version ${side} indexes…`;
			await yieldToRenderer();
			this.importDiagnostics = [
				...this.importDiagnostics.filter((diagnostic) => diagnostic.side !== side),
				...parsedFiles.flatMap((result) => result.diagnostics),
				...diagnoseDocumentSet(side, files)
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
