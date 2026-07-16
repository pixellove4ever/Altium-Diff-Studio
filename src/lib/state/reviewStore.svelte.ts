import {
	getBomDiff,
	getPcbDiffBundle,
	getSchematicComponentDiff,
	type DiffStatus
} from '$lib/diff/altiumDiff';
import { createReviewReportHtml } from '$lib/domain/reviewReport';
import {
	createReviewSession,
	parseReviewSession,
	type ReviewSnapshot
} from '$lib/domain/reviewSession';
import { importStore } from '$lib/state/importStore.svelte';
import { localeStore } from '$lib/state/localeStore.svelte';
import { projectStore, type WorkspaceTab } from '$lib/state/projectStore.svelte';

type ReviewWorkspaceTab = Extract<WorkspaceTab, 'pcb' | 'schematic' | 'bom'>;
export type ReviewFilter = 'all' | Exclude<DiffStatus, 'unchanged'> | 'pending';
export type ReviewSourceFilter = 'all' | ReviewWorkspaceTab;
export type ReviewReportScope = 'complete' | 'filtered';

export type ReviewChange = {
	key: string;
	kind: 'component' | 'net';
	value: string;
	designator: string;
	status: Exclude<DiffStatus, 'unchanged'>;
	sources: ReviewWorkspaceTab[];
	summary: string;
};

function visiblePanelCanvases() {
	if (typeof document === 'undefined') return [];
	return Array.from(document.querySelectorAll<HTMLCanvasElement>('.panel canvas'))
		.filter((canvas) => {
			const rect = canvas.getBoundingClientRect();
			return rect.width > 20 && rect.height > 20 && canvas.offsetParent !== null;
		})
		.slice(0, 2);
}

class ReviewStore {
	filter = $state<ReviewFilter>('all');
	sourceFilter = $state<ReviewSourceFilter>('all');
	reportScope = $state<ReviewReportScope>('complete');
	reviewedChanges = $state<Set<string>>(new Set());
	notes = $state<Record<string, string>>({});
	snapshots = $state<Record<string, ReviewSnapshot>>({});
	author = $state('');
	modifiedAt = $state('');
	sessionImportMode = $state<'merge' | 'replace'>('merge');
	loadedStorageKey = $state('');
	sessionInput = $state<HTMLInputElement | null>(null);

	changes = $derived.by<ReviewChange[]>(() => {
		if (
			projectStore.mode !== 'compare' ||
			projectStore.filesA.length === 0 ||
			projectStore.filesB.length === 0
		)
			return [];
		const changes = new Map<string, ReviewChange>();
		const add = (
			designator: string,
			status: Exclude<DiffStatus, 'unchanged'>,
			source: ReviewWorkspaceTab,
			summary: string
		) => {
			const key = `COMPONENT:${designator.toUpperCase()}`;
			const current = changes.get(key);
			if (!current) {
				changes.set(key, {
					key,
					kind: 'component',
					value: designator,
					designator,
					status,
					sources: [source],
					summary
				});
				return;
			}
			if (!current.sources.includes(source)) current.sources.push(source);
			if (current.status !== status) current.status = 'modified';
			if (!current.summary && summary) current.summary = summary;
		};
		const routingByNet = new Map<
			string,
			{
				name: string;
				statuses: Array<Exclude<DiffStatus, 'unchanged'>>;
				count: number;
				kinds: Set<string>;
			}
		>();
		const addRouting = (net: string | undefined, status: DiffStatus, kind: string) => {
			if (!net || status === 'unchanged') return;
			const key = net.toUpperCase();
			const current = routingByNet.get(key) ?? {
				name: net,
				statuses: [],
				count: 0,
				kinds: new Set<string>()
			};
			current.statuses.push(status);
			current.count += 1;
			current.kinds.add(kind);
			routingByNet.set(key, current);
		};
		for (const diff of getBomDiff(projectStore.projectA.bom, projectStore.projectB.bom)) {
			if (diff.status === 'unchanged') continue;
			add(
				diff.designator,
				diff.status,
				'bom',
				diff.after?.comment || diff.before?.comment || 'BOM component'
			);
		}
		const pcbDiff = getPcbDiffBundle(projectStore.projectA.pcb, projectStore.projectB.pcb);
		for (const diff of pcbDiff.components) {
			if (diff.status === 'unchanged') continue;
			add(
				diff.designator,
				diff.status,
				'pcb',
				diff.after?.comment || diff.before?.comment || 'PCB component'
			);
		}
		for (const diff of getSchematicComponentDiff(
			projectStore.projectA.schematic,
			projectStore.projectB.schematic
		)) {
			if (diff.status === 'unchanged') continue;
			add(
				diff.designator,
				diff.status,
				'schematic',
				diff.after?.value ||
					diff.after?.comment ||
					diff.before?.value ||
					diff.before?.comment ||
					'Schematic component'
			);
		}
		for (const diff of pcbDiff.tracks) addRouting(diff.item.net, diff.status, 'tracks');
		for (const diff of pcbDiff.arcs) addRouting(diff.item.net, diff.status, 'arcs');
		for (const diff of pcbDiff.vias) addRouting(diff.item.net, diff.status, 'vias');
		for (const diff of pcbDiff.pads) addRouting(diff.item.net, diff.status, 'pads');
		for (const diff of pcbDiff.polygons) addRouting(diff.item.net, diff.status, 'planes');
		for (const routing of routingByNet.values()) {
			const uniqueStatuses = new Set(routing.statuses);
			const status = uniqueStatuses.size === 1 ? routing.statuses[0] : 'modified';
			const key = `NET:${routing.name.toUpperCase()}`;
			changes.set(key, {
				key,
				kind: 'net',
				value: routing.name,
				designator: routing.name,
				status,
				sources: ['pcb'],
				summary: `${routing.count} changed ${Array.from(routing.kinds).join(', ')}`
			});
		}
		return Array.from(changes.values()).sort((left, right) =>
			left.designator.localeCompare(right.designator, undefined, { numeric: true })
		);
	});

	visibleChanges = $derived(
		this.changes.filter((change) => {
			const matchesStatus =
				this.filter === 'all'
					? true
					: this.filter === 'pending'
						? !this.reviewedChanges.has(change.key)
						: change.status === this.filter;
			const matchesSource =
				this.sourceFilter === 'all' || change.sources.includes(this.sourceFilter);
			return matchesStatus && matchesSource;
		})
	);

	reviewedCount = $derived(
		this.changes.filter((change) => this.reviewedChanges.has(change.key)).length
	);

	stats = $derived.by(() => {
		const statuses = { added: 0, modified: 0, removed: 0 };
		const sources: Record<ReviewWorkspaceTab, number> = { pcb: 0, schematic: 0, bom: 0 };
		let components = 0;
		let nets = 0;
		for (const change of this.changes) {
			statuses[change.status] += 1;
			if (change.kind === 'component') components += 1;
			else nets += 1;
			for (const source of change.sources) sources[source] += 1;
		}
		return { statuses, sources, components, nets };
	});

	storageKey = $derived.by(() => {
		if (!projectStore.isReady || projectStore.mode !== 'compare') return '';
		const identify = (files: typeof projectStore.filesA) =>
			files
				.map((file) => `${file.name}:${file.size}`)
				.sort()
				.join('|');
		return `ads:review:${identify(projectStore.filesA)}::${identify(projectStore.filesB)}`;
	});

	selectedComponentChange = $derived.by(() => {
		const selected = projectStore.selectedB ?? projectStore.selectedA;
		return selected
			? (this.changes.find(
					(change) =>
						change.kind === 'component' &&
						change.value.toUpperCase() === selected.designator.toUpperCase()
				) ?? null)
			: null;
	});

	selectedNetChange = $derived(
		projectStore.selectedNet
			? (this.changes.find(
					(change) =>
						change.kind === 'net' &&
						change.value.toUpperCase() === projectStore.selectedNet?.toUpperCase()
				) ?? null)
			: null
	);

	restore(storage: Storage) {
		const key = this.storageKey;
		if (!key || key === this.loadedStorageKey) return;
		try {
			const saved = JSON.parse(storage.getItem(key) ?? '{}') as {
				reviewed?: string[];
				notes?: Record<string, string>;
				snapshots?: Record<string, ReviewSnapshot>;
				author?: string;
				modifiedAt?: string;
			};
			this.reviewedChanges = new Set(
				(saved.reviewed ?? []).map((key) =>
					key.includes(':') ? key : `COMPONENT:${key.toUpperCase()}`
				)
			);
			this.notes = saved.notes ?? {};
			this.snapshots = saved.snapshots ?? {};
			this.author = saved.author ?? '';
			this.modifiedAt = saved.modifiedAt ?? '';
		} catch {
			this.clearSessionState();
		}
		this.loadedStorageKey = key;
	}

	persist(storage: Storage) {
		if (!this.loadedStorageKey || this.loadedStorageKey !== this.storageKey) return;
		try {
			storage.setItem(
				this.loadedStorageKey,
				JSON.stringify({
					reviewed: Array.from(this.reviewedChanges),
					notes: this.notes,
					snapshots: this.snapshots,
					author: this.author,
					modifiedAt: this.modifiedAt
				})
			);
		} catch {
			projectStore.warning =
				'Review storage is full. Remove a snapshot or export the session before continuing.';
		}
	}

	reset() {
		this.clearSessionState();
		this.filter = 'all';
		this.sourceFilter = 'all';
		this.reportScope = 'complete';
		this.loadedStorageKey = '';
	}

	private clearSessionState() {
		this.reviewedChanges = new Set();
		this.notes = {};
		this.snapshots = {};
		this.author = '';
		this.modifiedAt = '';
	}

	openChange(designator: string, tab?: WorkspaceTab) {
		projectStore.selectDesignator(designator);
		if (tab && projectStore.availableTabs.includes(tab)) {
			projectStore.activeTab = tab;
			return;
		}
		const change = this.changes.find(
			(item) => item.kind === 'component' && item.value.toUpperCase() === designator.toUpperCase()
		);
		const target = change?.sources.find((source) => projectStore.availableTabs.includes(source));
		if (target) projectStore.activeTab = target;
	}

	openItem(change: ReviewChange, tab?: WorkspaceTab) {
		if (change.kind === 'net') {
			projectStore.selectNet(change.value);
			projectStore.activeTab = 'pcb';
			return;
		}
		this.openChange(change.value, tab);
	}

	touch() {
		this.modifiedAt = new Date().toISOString();
	}

	toggleReviewed(key: string) {
		const next = new Set(this.reviewedChanges);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		this.reviewedChanges = next;
		this.touch();
	}

	updateNote(key: string, note: string) {
		this.notes = { ...this.notes, [key]: note };
		this.touch();
	}

	captureSnapshot(key: string) {
		const canvases = visiblePanelCanvases();
		if (canvases.length === 0) {
			projectStore.warning = 'Open a PCB or schematic Canvas before capturing a review snapshot.';
			return;
		}
		const width = 720;
		const height = 405;
		const cellWidth = width / canvases.length;
		const snapshot = document.createElement('canvas');
		snapshot.width = width;
		snapshot.height = height;
		const context = snapshot.getContext('2d');
		if (!context) return;
		context.fillStyle = projectStore.activeTab === 'pcb' ? '#111827' : '#fbfcff';
		context.fillRect(0, 0, width, height);
		for (const [index, canvas] of canvases.entries()) {
			const scale = Math.min(cellWidth / canvas.width, height / canvas.height);
			const targetWidth = canvas.width * scale;
			const targetHeight = canvas.height * scale;
			context.drawImage(
				canvas,
				index * cellWidth + (cellWidth - targetWidth) / 2,
				(height - targetHeight) / 2,
				targetWidth,
				targetHeight
			);
		}
		this.snapshots = {
			...this.snapshots,
			[key]: {
				dataUrl: snapshot.toDataURL('image/jpeg', 0.72),
				view: projectStore.activeTab.toUpperCase(),
				capturedAt: new Date().toISOString()
			}
		};
		this.touch();
		projectStore.warning = null;
	}

	removeSnapshot(key: string) {
		const next = { ...this.snapshots };
		delete next[key];
		this.snapshots = next;
		this.touch();
	}

	exportSession() {
		if (!this.storageKey) return;
		const modifiedAt = new Date().toISOString();
		this.modifiedAt = modifiedAt;
		const session = createReviewSession(
			this.storageKey,
			this.reviewedChanges,
			this.notes,
			this.snapshots,
			{ author: this.author, modifiedAt }
		);
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `altium-review-session-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async importSession(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const validKeys = new Set(this.changes.map((change) => change.key));
			const imported = parseReviewSession(await file.text(), this.storageKey, validKeys);
			if (this.sessionImportMode === 'merge') {
				this.reviewedChanges = new Set([...this.reviewedChanges, ...imported.reviewed]);
				this.notes = { ...this.notes, ...imported.notes };
				this.snapshots = { ...this.snapshots, ...imported.snapshots };
			} else {
				this.reviewedChanges = new Set(imported.reviewed);
				this.notes = imported.notes;
				this.snapshots = imported.snapshots;
			}
			this.author =
				this.sessionImportMode === 'merge' ? imported.author || this.author : imported.author;
			this.modifiedAt = imported.modifiedAt;
			projectStore.error = null;
			const ignored = [
				...imported.ignored.reviewed.map((key) => `reviewed:${key}`),
				...imported.ignored.notes.map((key) => `note:${key}`),
				...imported.ignored.snapshots.map((key) => `snapshot:${key}`)
			];
			const migration = imported.migratedFrom
				? ` Migrated from format v${imported.migratedFrom} to v3.`
				: '';
			const ignoredMessage =
				ignored.length > 0 ? ` Ignored ${ignored.length}: ${ignored.join(', ')}.` : '';
			projectStore.warning = `Review session ${this.sessionImportMode === 'merge' ? 'merged' : 'replaced'}: ${this.reviewedChanges.size}/${this.changes.length} changes reviewed.${migration}${ignoredMessage}`;
		} catch (error) {
			projectStore.error =
				error instanceof Error ? error.message : 'Unable to import the review session.';
		}
	}

	private captureReportImages() {
		return visiblePanelCanvases().map((canvas, index) => {
			const width = Math.min(1400, canvas.width);
			const height = Math.max(1, Math.round((canvas.height / canvas.width) * width));
			const snapshot = document.createElement('canvas');
			snapshot.width = width;
			snapshot.height = height;
			snapshot.getContext('2d')?.drawImage(canvas, 0, 0, width, height);
			return {
				label: `${projectStore.activeTab.toUpperCase()} view${index > 0 ? ` ${index + 1}` : ''}`,
				dataUrl: snapshot.toDataURL('image/jpeg', 0.84)
			};
		});
	}

	buildReportHtml() {
		const reportChanges = this.reportScope === 'filtered' ? this.visibleChanges : this.changes;
		const reportFiles = (side: 'A' | 'B') => {
			const jsonFiles = side === 'A' ? projectStore.filesA : projectStore.filesB;
			const pdf = side === 'A' ? projectStore.pdfA : projectStore.pdfB;
			const dxfs = side === 'A' ? projectStore.dxfA : projectStore.dxfB;
			return [
				...jsonFiles.map((file) => ({
					side,
					name: file.path || file.name,
					size: file.size,
					type: file.doc.type,
					exportMeta: file.doc.exportMeta
				})),
				...(pdf ? [{ side, name: pdf.path || pdf.name, size: pdf.size, type: 'Smart PDF' }] : []),
				...dxfs.map((file) => ({
					side,
					name: file.path || file.name,
					size: file.size,
					type: 'DXF'
				}))
			];
		};
		return createReviewReportHtml({
			title: `Altium review ${__APP_VERSION__} - ${projectStore.filesA[0]?.name ?? 'A'} -> ${projectStore.filesB[0]?.name ?? 'B'}`,
			locale: localeStore.locale,
			generatedAt: new Date().toLocaleString(),
			changes: reportChanges,
			scope: this.reportScope,
			totalChanges: this.changes.length,
			reviewed: this.reviewedChanges,
			notes: this.notes,
			snapshots: this.snapshots,
			stats: this.stats,
			captures: this.captureReportImages(),
			files: [...reportFiles('A'), ...reportFiles('B')],
			diagnostics: importStore.importDiagnostics.flatMap((diagnostic) =>
				diagnostic.severity === 'info'
					? []
					: [
							{
								side: diagnostic.side,
								file: diagnostic.file,
								severity: diagnostic.severity,
								message: diagnostic.message
							}
						]
			)
		});
	}

	exportHtml() {
		const html = this.buildReportHtml();
		const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `altium-review-${new Date().toISOString().slice(0, 10)}.html`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async exportPdf() {
		const date = new Date().toISOString().slice(0, 10);
		if (window.altiumDiff?.savePdfReport) {
			await window.altiumDiff.savePdfReport(this.buildReportHtml(), `altium-review-${date}.pdf`);
			return;
		}
		this.exportHtml();
	}
}

export const reviewStore = new ReviewStore();
