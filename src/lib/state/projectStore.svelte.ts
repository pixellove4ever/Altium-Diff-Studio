import type { AltiumDoc, AltiumProjectSet } from '$lib/types/altium';
import { buildProjectIndex, type ComponentCategory } from '$lib/domain/project';
import { applyProjectFiles, exporterCompatibilityWarning } from '$lib/domain/projectLoading';
import type { GerberFile } from '$lib/diff/fabrication/gerberDiff';
import type { OdbPackageFile } from '$lib/domain/fabrication/files';

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

const emptySet = (): AltiumProjectSet => ({
	bom: null,
	pcb: null,
	schematic: null
});

const docTypeToTab = (type: AltiumDoc['type']): WorkspaceTab => type;
const loadedTypes = (files: LoadedJsonFile[]) =>
	Array.from(new Set(files.map((file) => file.doc.type)));

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
	selectionHistory = $state<Array<{ kind: 'component' | 'net'; value: string }>>([]);
	selectionHistoryIndex = $state(-1);

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
		this.mode === 'view'
			? this.hasLoadedSide('A')
			: this.hasLoadedSide('A') && this.hasLoadedSide('B')
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

		this.warning = exporterCompatibilityWarning([...this.filesA, ...this.filesB]);
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
		this.selectionHistory = [];
		this.selectionHistoryIndex = -1;
	}
}

export const projectStore = new ProjectStore();
