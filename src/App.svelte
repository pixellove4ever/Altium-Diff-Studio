<script lang="ts">
	import { onMount } from 'svelte';
	import type { AppCommand } from '../electron/preload';
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import ProjectDropZone from '$lib/components/ProjectDropZone.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import {
		getBomDiff,
		getPcbDiffBundle,
		getSchematicComponentDiff,
		type DiffStatus
	} from '$lib/diff/altiumDiff';
	import { searchProject, type ComponentCategory } from '$lib/domain/project';
	import { createReviewReportHtml } from '$lib/domain/reviewReport';
	import {
		createReviewSession,
		parseReviewSession,
		type ReviewSnapshot
	} from '$lib/domain/reviewSession';
	import { projectStore, type WorkspaceTab } from '$lib/state/projectStore.svelte';

	const tabs: Array<{ id: WorkspaceTab; label: string }> = [
		{ id: 'pcb', label: 'PCB Diff' },
		{ id: 'schematic', label: 'Schematic Diff' },
		{ id: 'bom', label: 'BOM Diff' }
	];

	const isReady = $derived(projectStore.isReady);
	const activeIndex = $derived(
		projectStore.mode === 'compare' ? projectStore.indexB : projectStore.indexA
	);
	const searchResults = $derived(
		searchProject(activeIndex, projectStore.searchQuery, projectStore.componentCategory).slice(
			0,
			80
		)
	);
	const selected = $derived(projectStore.selectedB ?? projectStore.selectedA);
	const categories: Array<{ id: ComponentCategory; label: string }> = [
		{ id: 'all', label: 'All components' },
		{ id: 'resistor', label: 'Resistors' },
		{ id: 'capacitor', label: 'Capacitors' },
		{ id: 'ic', label: 'ICs' },
		{ id: 'connector', label: 'Connectors' },
		{ id: 'power', label: 'Power' },
		{ id: 'testpoint', label: 'Testpoints' }
	];
	let modeChosen = $state(false);
	let sidebarCollapsed = $state(false);
	let reviewFilter = $state<'all' | Exclude<DiffStatus, 'unchanged'> | 'pending'>('all');
	let reviewSourceFilter = $state<'all' | WorkspaceTab>('all');
	let reviewReportScope = $state<'complete' | 'filtered'>('complete');
	let reviewedChanges = $state<Set<string>>(new Set());
	let reviewNotes = $state<Record<string, string>>({});
	let reviewSnapshots = $state<Record<string, ReviewSnapshot>>({});
	let reviewAuthor = $state('');
	let reviewModifiedAt = $state('');
	let reviewSessionImportMode = $state<'merge' | 'replace'>('merge');
	let loadedReviewKey = $state('');
	let commandOpen = $state(false);
	let commandQuery = $state('');
	let commandInput = $state<HTMLInputElement | null>(null);
	let helpOpen = $state(false);
	let reviewSessionInput = $state<HTMLInputElement | null>(null);

	const reviewChanges = $derived.by(() => {
		type ReviewChange = {
			key: string;
			kind: 'component' | 'net';
			value: string;
			designator: string;
			status: Exclude<DiffStatus, 'unchanged'>;
			sources: WorkspaceTab[];
			summary: string;
		};
		if (
			projectStore.mode !== 'compare' ||
			projectStore.filesA.length === 0 ||
			projectStore.filesB.length === 0
		)
			return [] as ReviewChange[];
		const changes = new Map<string, ReviewChange>();
		const add = (
			designator: string,
			status: Exclude<DiffStatus, 'unchanged'>,
			source: WorkspaceTab,
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
	const visibleReviewChanges = $derived(
		reviewChanges.filter((change) => {
			const matchesStatus =
				reviewFilter === 'all'
					? true
					: reviewFilter === 'pending'
						? !reviewedChanges.has(change.key)
						: change.status === reviewFilter;
			const matchesSource =
				reviewSourceFilter === 'all' || change.sources.includes(reviewSourceFilter);
			return matchesStatus && matchesSource;
		})
	);
	const reviewedCount = $derived(
		reviewChanges.filter((change) => reviewedChanges.has(change.key)).length
	);
	const reviewStats = $derived.by(() => {
		const statuses = { added: 0, modified: 0, removed: 0 };
		const sources: Record<WorkspaceTab, number> = { pcb: 0, schematic: 0, bom: 0 };
		let components = 0;
		let nets = 0;
		for (const change of reviewChanges) {
			statuses[change.status] += 1;
			if (change.kind === 'component') components += 1;
			else nets += 1;
			for (const source of change.sources) sources[source] += 1;
		}
		return { statuses, sources, components, nets };
	});
	const reviewStorageKey = $derived.by(() => {
		if (!isReady || projectStore.mode !== 'compare') return '';
		const identify = (files: typeof projectStore.filesA) =>
			files
				.map((file) => `${file.name}:${file.size}`)
				.sort()
				.join('|');
		return `ads:review:${identify(projectStore.filesA)}::${identify(projectStore.filesB)}`;
	});
	const selectedReviewChange = $derived(
		selected
			? (reviewChanges.find(
					(change) =>
						change.kind === 'component' &&
						change.value.toUpperCase() === selected.designator.toUpperCase()
				) ?? null)
			: null
	);
	const selectedNetReviewChange = $derived(
		projectStore.selectedNet
			? (reviewChanges.find(
					(change) =>
						change.kind === 'net' &&
						change.value.toUpperCase() === projectStore.selectedNet?.toUpperCase()
				) ?? null)
			: null
	);
	const commandComponents = $derived(searchProject(activeIndex, commandQuery, 'all').slice(0, 7));
	const commandNets = $derived(
		commandQuery.trim()
			? activeIndex.nets
					.filter((net) => net.toLowerCase().includes(commandQuery.trim().toLowerCase()))
					.slice(0, 7)
			: []
	);
	const diagnosticProblems = $derived(
		projectStore.importDiagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length
	);

	onMount(() => {
		const savedMinimal = window.localStorage.getItem('ads:minimal-ui');
		if (savedMinimal !== null) projectStore.minimalUi = savedMinimal !== 'false';
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				commandOpen = !commandOpen;
				if (!commandOpen) commandQuery = '';
				return;
			}
			if (event.key === 'Escape' && commandOpen) {
				commandOpen = false;
				commandQuery = '';
				return;
			}
			if (event.key === 'Escape' && helpOpen) {
				helpOpen = false;
				return;
			}
			if (event.key === 'F1') {
				event.preventDefault();
				helpOpen = true;
				return;
			}
			if (!event.altKey || !isReady) return;
			const tab =
				event.key === '1'
					? 'pcb'
					: event.key === '2'
						? 'schematic'
						: event.key === '3'
							? 'bom'
							: null;
			if (tab && projectStore.availableTabs.includes(tab as WorkspaceTab)) {
				event.preventDefault();
				projectStore.activeTab = tab as WorkspaceTab;
			}
		};
		const handleCommand = (command: AppCommand) => {
			if (command === 'new-workspace') returnHome();
			else if (command === 'open-a') void openNativeFiles('A');
			else if (command === 'open-b') void openNativeFiles('B');
			else if (command === 'command-palette') commandOpen = true;
			else if (command === 'show-help') helpOpen = true;
			else if (command === 'toggle-tools') projectStore.minimalUi = !projectStore.minimalUi;
			else if (command === 'toggle-inspector' && isReady) sidebarCollapsed = !sidebarCollapsed;
			else {
				const tab =
					command === 'open-pcb'
						? 'pcb'
						: command === 'open-schematic'
							? 'schematic'
							: command === 'open-bom'
								? 'bom'
								: null;
				if (tab && projectStore.availableTabs.includes(tab)) projectStore.activeTab = tab;
			}
		};
		window.addEventListener('keydown', onKeyDown);
		const removeCommandListener = window.altiumDiff?.onCommand(handleCommand);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			removeCommandListener?.();
		};
	});

	$effect(() => {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem('ads:minimal-ui', String(projectStore.minimalUi));
		}
	});

	$effect(() => {
		const key = reviewStorageKey;
		if (!key || key === loadedReviewKey) return;
		try {
			const saved = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
				reviewed?: string[];
				notes?: Record<string, string>;
				snapshots?: Record<string, ReviewSnapshot>;
				author?: string;
				modifiedAt?: string;
			};
			reviewedChanges = new Set(
				(saved.reviewed ?? []).map((key) =>
					key.includes(':') ? key : `COMPONENT:${key.toUpperCase()}`
				)
			);
			reviewNotes = saved.notes ?? {};
			reviewSnapshots = saved.snapshots ?? {};
			reviewAuthor = saved.author ?? '';
			reviewModifiedAt = saved.modifiedAt ?? '';
		} catch {
			reviewedChanges = new Set();
			reviewNotes = {};
			reviewSnapshots = {};
			reviewAuthor = '';
			reviewModifiedAt = '';
		}
		loadedReviewKey = key;
	});

	$effect(() => {
		if (!loadedReviewKey || loadedReviewKey !== reviewStorageKey) return;
		try {
			window.localStorage.setItem(
				loadedReviewKey,
				JSON.stringify({
					reviewed: Array.from(reviewedChanges),
					notes: reviewNotes,
					snapshots: reviewSnapshots,
					author: reviewAuthor,
					modifiedAt: reviewModifiedAt
				})
			);
		} catch {
			projectStore.warning =
				'Review storage is full. Remove a snapshot or export the session before continuing.';
		}
	});

	$effect(() => {
		if (commandOpen && commandInput) {
			queueMicrotask(() => commandInput?.focus());
		}
	});

	function chooseMode(mode: 'compare' | 'view') {
		projectStore.setMode(mode);
		modeChosen = true;
	}

	function returnHome() {
		projectStore.reset();
		modeChosen = false;
		sidebarCollapsed = false;
		reviewedChanges = new Set();
		reviewNotes = {};
		reviewSnapshots = {};
		reviewAuthor = '';
		reviewModifiedAt = '';
		reviewFilter = 'all';
		reviewSourceFilter = 'all';
		reviewReportScope = 'complete';
		loadedReviewKey = '';
	}

	function openReviewChange(designator: string, tab?: WorkspaceTab) {
		projectStore.selectDesignator(designator);
		if (tab && projectStore.availableTabs.includes(tab)) {
			projectStore.activeTab = tab;
			return;
		}
		const change = reviewChanges.find(
			(item) => item.kind === 'component' && item.value.toUpperCase() === designator.toUpperCase()
		);
		const target = change?.sources.find((source) => projectStore.availableTabs.includes(source));
		if (target) projectStore.activeTab = target;
	}

	function openReviewItem(change: (typeof reviewChanges)[number], tab?: WorkspaceTab) {
		if (change.kind === 'net') {
			projectStore.selectNet(change.value);
			projectStore.activeTab = 'pcb';
			return;
		}
		openReviewChange(change.value, tab);
	}

	function touchReview() {
		reviewModifiedAt = new Date().toISOString();
	}

	function toggleReviewed(key: string) {
		const next = new Set(reviewedChanges);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		reviewedChanges = next;
		touchReview();
	}

	function updateReviewNote(key: string, note: string) {
		reviewNotes = { ...reviewNotes, [key]: note };
		touchReview();
	}

	function visiblePanelCanvases() {
		return Array.from(document.querySelectorAll<HTMLCanvasElement>('.panel canvas'))
			.filter((canvas) => {
				const rect = canvas.getBoundingClientRect();
				return rect.width > 20 && rect.height > 20 && canvas.offsetParent !== null;
			})
			.slice(0, 2);
	}

	function captureReviewSnapshot(key: string) {
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
		reviewSnapshots = {
			...reviewSnapshots,
			[key]: {
				dataUrl: snapshot.toDataURL('image/jpeg', 0.72),
				view: projectStore.activeTab.toUpperCase(),
				capturedAt: new Date().toISOString()
			}
		};
		touchReview();
		projectStore.warning = null;
	}

	function removeReviewSnapshot(key: string) {
		const next = { ...reviewSnapshots };
		delete next[key];
		reviewSnapshots = next;
		touchReview();
	}

	function exportReviewSession() {
		if (!reviewStorageKey) return;
		const modifiedAt = new Date().toISOString();
		reviewModifiedAt = modifiedAt;
		const session = createReviewSession(
			reviewStorageKey,
			reviewedChanges,
			reviewNotes,
			reviewSnapshots,
			{ author: reviewAuthor, modifiedAt }
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

	async function importReviewSession(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const validKeys = new Set(reviewChanges.map((change) => change.key));
			const imported = parseReviewSession(await file.text(), reviewStorageKey, validKeys);
			if (reviewSessionImportMode === 'merge') {
				reviewedChanges = new Set([...reviewedChanges, ...imported.reviewed]);
				reviewNotes = { ...reviewNotes, ...imported.notes };
				reviewSnapshots = { ...reviewSnapshots, ...imported.snapshots };
			} else {
				reviewedChanges = new Set(imported.reviewed);
				reviewNotes = imported.notes;
				reviewSnapshots = imported.snapshots;
			}
			reviewAuthor =
				reviewSessionImportMode === 'merge' ? imported.author || reviewAuthor : imported.author;
			reviewModifiedAt = imported.modifiedAt;
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
			projectStore.warning = `Review session ${reviewSessionImportMode === 'merge' ? 'merged' : 'replaced'}: ${reviewedChanges.size}/${reviewChanges.length} changes reviewed.${migration}${ignoredMessage}`;
		} catch (error) {
			projectStore.error =
				error instanceof Error ? error.message : 'Unable to import the review session.';
		}
	}

	function captureReportImages() {
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

	function buildReviewReportHtml() {
		const reportChanges = reviewReportScope === 'filtered' ? visibleReviewChanges : reviewChanges;
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
			title: `Altium review · ${projectStore.filesA[0]?.name ?? 'A'} → ${projectStore.filesB[0]?.name ?? 'B'}`,
			generatedAt: new Date().toLocaleString(),
			changes: reportChanges,
			scope: reviewReportScope,
			totalChanges: reviewChanges.length,
			reviewed: reviewedChanges,
			notes: reviewNotes,
			snapshots: reviewSnapshots,
			stats: reviewStats,
			captures: captureReportImages(),
			files: [...reportFiles('A'), ...reportFiles('B')],
			diagnostics: projectStore.importDiagnostics.flatMap((diagnostic) =>
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

	function exportReviewHtml() {
		const html = buildReviewReportHtml();
		const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `altium-review-${new Date().toISOString().slice(0, 10)}.html`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function exportReviewPdf() {
		const date = new Date().toISOString().slice(0, 10);
		if (window.altiumDiff?.savePdfReport) {
			await window.altiumDiff.savePdfReport(buildReviewReportHtml(), `altium-review-${date}.pdf`);
			return;
		}
		exportReviewHtml();
	}

	function exportDiagnostics() {
		const report = {
			generatedAt: new Date().toISOString(),
			mode: projectStore.mode,
			filesA: projectStore.filesA.map((file) => ({
				name: file.name,
				size: file.size,
				type: file.doc.type,
				exporter: file.doc.exportMeta
			})),
			filesB: projectStore.filesB.map((file) => ({
				name: file.name,
				size: file.size,
				type: file.doc.type,
				exporter: file.doc.exportMeta
			})),
			diagnostics: projectStore.importDiagnostics
		};
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `altium-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function closeCommands() {
		commandOpen = false;
		commandQuery = '';
	}

	function commandSelectComponent(designator: string) {
		projectStore.selectDesignator(designator);
		closeCommands();
	}

	function commandSelectNet(net: string) {
		projectStore.selectNet(net);
		closeCommands();
	}

	async function openNativeFiles(side: 'A' | 'B') {
		const files = await window.altiumDiff?.chooseProjectFiles();
		if (!files?.length) return;
		if (!modeChosen) {
			projectStore.setMode(side === 'A' ? 'view' : 'compare');
			modeChosen = true;
		} else if (side === 'B' && projectStore.mode !== 'compare') {
			projectStore.mode = 'compare';
		}
		await projectStore.loadNativeFiles(side, files);
	}
</script>

<svelte:head>
	<title>Altium Diff Studio</title>
</svelte:head>

<main class:workspace={isReady} class:minimal={projectStore.minimalUi}>
	{#if projectStore.loadingSide}
		<div class="import-progress" role="status" aria-live="polite">
			<span class="import-spinner"></span>
			<div>
				<strong>Loading version {projectStore.loadingSide}</strong>
				<span>{projectStore.loadingMessage}</span>
			</div>
			<button onclick={() => projectStore.cancelImport()}>Cancel</button>
		</div>
	{/if}
	<header class="topbar">
		<div>
			<h1>◈ Altium Diff Studio</h1>
			<p>
				{projectStore.mode === 'view'
					? 'Local viewer for PCB, schematic, and BOM exports.'
					: 'Local hardware review workspace for BOM, PCB, and schematic deltas.'}
			</p>
		</div>
		{#if modeChosen}
			<div class="topbar-actions">
				<button
					class="command-trigger"
					title="Command palette (Ctrl+K)"
					onclick={() => (commandOpen = true)}
				>
					Search <kbd>Ctrl K</kbd>
				</button>
				{#if isReady}
					{#if diagnosticProblems > 0}
						<span class="diagnostic-badge" title="Import diagnostics">{diagnosticProblems}</span>
					{/if}
					<div class="history-actions" aria-label="Selection history">
						<button
							disabled={!projectStore.canNavigateBack}
							title="Previous selection"
							onclick={() => projectStore.navigateSelection(-1)}>←</button
						>
						<button
							disabled={!projectStore.canNavigateForward}
							title="Next selection"
							onclick={() => projectStore.navigateSelection(1)}>→</button
						>
					</div>
					<button
						class:active={!projectStore.minimalUi}
						title="Show or hide secondary tools"
						onclick={() => (projectStore.minimalUi = !projectStore.minimalUi)}
					>
						{projectStore.minimalUi ? 'Tools' : 'Less'}
					</button>
					<button onclick={() => (sidebarCollapsed = !sidebarCollapsed)}>
						{sidebarCollapsed ? 'Show inspector' : 'Focus canvas'}
					</button>
				{/if}
				<button onclick={returnHome}>New workspace</button>
			</div>
		{/if}
	</header>

	{#if projectStore.error}
		<section class="error">{projectStore.error}</section>
	{/if}
	{#if projectStore.warning}
		<section class="warning">{projectStore.warning}</section>
	{/if}
	{#if projectStore.importDiagnostics.length > 0 && (!projectStore.minimalUi || diagnosticProblems > 0)}
		<details class="diagnostics-panel">
			<summary>
				<span>Import diagnostics</span>
				<b
					>{diagnosticProblems > 0
						? `${diagnosticProblems} issue${diagnosticProblems > 1 ? 's' : ''}`
						: 'Validated'}</b
				>
			</summary>
			<div>
				{#each projectStore.importDiagnostics as diagnostic}
					<p class={diagnostic.severity}>
						<strong>{diagnostic.side} · {diagnostic.file}</strong>
						<span>{diagnostic.message}</span>
					</p>
				{/each}
				<button onclick={exportDiagnostics}>Export diagnostics</button>
			</div>
		</details>
	{/if}

	{#if !modeChosen}
		<section class="mode-choice">
			<button onclick={() => chooseMode('view')}>
				<strong>View a project</strong>
				<span>Open one Altium export for inspection.</span>
			</button>
			<button onclick={() => chooseMode('compare')}>
				<strong>Compare two versions</strong>
				<span>Review changes between a baseline and a candidate.</span>
			</button>
		</section>
	{:else if !isReady}
		<section class="landing">
			<ProjectDropZone
				side="A"
				title={projectStore.mode === 'view' ? 'Project export' : 'Baseline export'}
			/>
			{#if projectStore.mode === 'compare'}
				<ProjectDropZone side="B" title="Candidate export" />
			{/if}
		</section>
	{:else}
		<section class="workspace-grid" class:sidebar-hidden={sidebarCollapsed}>
			{#if !sidebarCollapsed}
				<aside>
					<nav>
						{#each tabs as tab}
							<button
								class:active={projectStore.activeTab === tab.id}
								disabled={!projectStore.availableTabs.includes(tab.id)}
								onclick={() => (projectStore.activeTab = tab.id)}
							>
								{projectStore.mode === 'view' ? tab.label.replace(' Diff', '') : tab.label}
							</button>
						{/each}
					</nav>

					{#if projectStore.mode === 'compare'}
						<details class="review-panel" open={!projectStore.minimalUi}>
							<summary>
								<span>Review changes</span>
								<b>{reviewedCount}/{reviewChanges.length}</b>
							</summary>
							<div class="review-progress">
								<i
									style={`width:${reviewChanges.length > 0 ? (reviewedCount / reviewChanges.length) * 100 : 0}%`}
								></i>
							</div>
							<div class="review-stats" aria-label="Change summary">
								<span class="added" title="Added">{reviewStats.statuses.added}</span>
								<span class="modified" title="Modified">{reviewStats.statuses.modified}</span>
								<span class="removed" title="Removed">{reviewStats.statuses.removed}</span>
								<button
									class:active={reviewSourceFilter === 'pcb'}
									title="Filter PCB changes"
									onclick={() =>
										(reviewSourceFilter = reviewSourceFilter === 'pcb' ? 'all' : 'pcb')}
									>PCB {reviewStats.sources.pcb}</button
								>
								<button
									class:active={reviewSourceFilter === 'schematic'}
									title="Filter schematic changes"
									onclick={() =>
										(reviewSourceFilter = reviewSourceFilter === 'schematic' ? 'all' : 'schematic')}
									>SCH {reviewStats.sources.schematic}</button
								>
								<button
									class:active={reviewSourceFilter === 'bom'}
									title="Filter BOM changes"
									onclick={() =>
										(reviewSourceFilter = reviewSourceFilter === 'bom' ? 'all' : 'bom')}
									>BOM {reviewStats.sources.bom}</button
								>
							</div>
							<div class="export-review">
								<select bind:value={reviewReportScope} aria-label="Report scope">
									<option value="complete">Complete report</option>
									<option value="filtered">Current filters</option>
								</select>
								<button disabled={reviewChanges.length === 0} onclick={exportReviewHtml}>
									HTML
								</button>
								<button disabled={reviewChanges.length === 0} onclick={exportReviewPdf}>
									PDF
								</button>
								<button
									disabled={reviewChanges.length === 0}
									title="Export portable review session"
									onclick={exportReviewSession}>Session ↓</button
								>
								<button
									disabled={reviewChanges.length === 0}
									title="Import review session"
									onclick={() => reviewSessionInput?.click()}>Session ↑</button
								>
								<input
									class="review-session-input"
									bind:this={reviewSessionInput}
									type="file"
									accept=".json,application/json"
									onchange={importReviewSession}
								/>
							</div>
							<div class="session-options">
								<input
									bind:value={reviewAuthor}
									aria-label="Review author"
									placeholder="Review author"
									onchange={touchReview}
								/>
								<select bind:value={reviewSessionImportMode} aria-label="Session import mode">
									<option value="merge">Merge import</option>
									<option value="replace">Replace import</option>
								</select>
								{#if reviewModifiedAt}
									<small>
										Last modified {new Date(reviewModifiedAt).toLocaleString()}
										{reviewAuthor ? ` · ${reviewAuthor}` : ''}
									</small>
								{/if}
							</div>
							<div class="review-filters">
								{#each ['all', 'pending', 'added', 'modified', 'removed'] as filter}
									<button
										class:active={reviewFilter === filter}
										onclick={() =>
											(reviewFilter = filter as
												| 'all'
												| 'pending'
												| Exclude<DiffStatus, 'unchanged'>)}
									>
										{filter === 'all'
											? 'All'
											: filter === 'pending'
												? 'To review'
												: filter.slice(0, 1).toUpperCase()}
									</button>
								{/each}
							</div>
							<div class="review-list">
								{#each visibleReviewChanges as change}
									<div
										class:reviewed={reviewedChanges.has(change.key)}
										class={`review-item ${change.status}`}
									>
										<button class="review-main" onclick={() => openReviewItem(change)}>
											<strong>{change.kind === 'net' ? 'NET' : change.designator}</strong>
											<span
												>{change.kind === 'net'
													? `${change.value} · ${change.summary}`
													: change.summary}</span
											>
										</button>
										<div class="review-sources">
											{#each change.sources as source}
												<button
													title={`Open in ${source}`}
													onclick={() => openReviewItem(change, source)}
												>
													{source === 'schematic' ? 'SCH' : source.toUpperCase()}
												</button>
											{/each}
											<button
												class="review-check"
												title="Mark as reviewed"
												onclick={() => toggleReviewed(change.key)}
											>
												{reviewedChanges.has(change.key) ? '✓' : '○'}
											</button>
										</div>
									</div>
								{/each}
								{#if visibleReviewChanges.length === 0}
									<p>No change in this filter.</p>
								{/if}
							</div>
						</details>
					{/if}

					<div class="probe">
						<label for="designator">Project search</label>
						<input
							id="designator"
							placeholder="Designator, value, net, MPN…"
							bind:value={projectStore.searchQuery}
						/>
						{#if !projectStore.minimalUi}
							<select bind:value={projectStore.componentCategory}>
								{#each categories as category}
									<option value={category.id}>{category.label}</option>
								{/each}
							</select>
						{/if}
						{#if !projectStore.minimalUi || projectStore.searchQuery.trim()}
							<div class="search-results">
								{#each searchResults as component}
									<button
										class:selected={projectStore.selectedDesignator === component.designator}
										onclick={() => projectStore.selectDesignator(component.designator)}
									>
										<strong>{component.designator}</strong>
										<span
											>{component.bom?.comment ||
												component.schematic?.comment ||
												component.pcb?.comment ||
												component.category}</span
										>
									</button>
								{/each}
							</div>
						{/if}
					</div>

					{#if projectStore.mode === 'compare' && selectedNetReviewChange}
						<section class="net-review-card">
							<div>
								<strong>{selectedNetReviewChange.value}</strong>
								<button onclick={() => toggleReviewed(selectedNetReviewChange.key)}>
									{reviewedChanges.has(selectedNetReviewChange.key)
										? '✓ Reviewed'
										: 'Mark reviewed'}
								</button>
							</div>
							<small>{selectedNetReviewChange.summary}</small>
							<textarea
								rows="3"
								placeholder="Routing review note…"
								value={reviewNotes[selectedNetReviewChange.key] ?? ''}
								oninput={(event) =>
									updateReviewNote(
										selectedNetReviewChange.key,
										(event.currentTarget as HTMLTextAreaElement).value
									)}></textarea>
							<div class="snapshot-actions">
								<button onclick={() => captureReviewSnapshot(selectedNetReviewChange.key)}>
									{reviewSnapshots[selectedNetReviewChange.key]
										? 'Replace snapshot'
										: 'Capture view'}
								</button>
								{#if reviewSnapshots[selectedNetReviewChange.key]}
									<button onclick={() => removeReviewSnapshot(selectedNetReviewChange.key)}>
										Remove
									</button>
								{/if}
							</div>
							{#if reviewSnapshots[selectedNetReviewChange.key]}
								<figure class="review-snapshot">
									<img
										src={reviewSnapshots[selectedNetReviewChange.key].dataUrl}
										alt={`${selectedNetReviewChange.value} review snapshot`}
									/>
									<figcaption>
										{reviewSnapshots[selectedNetReviewChange.key].view} ·
										{new Date(
											reviewSnapshots[selectedNetReviewChange.key].capturedAt
										).toLocaleString()}
									</figcaption>
								</figure>
							{/if}
						</section>
					{/if}

					{#if selected}
						<section class="component-card">
							<div class="card-title">
								<strong>{selected.designator}</strong>
								<span>{selected.category}</span>
							</div>
							<p>
								{selected.bom?.comment ||
									selected.schematic?.comment ||
									selected.pcb?.comment ||
									'No value'}
							</p>
							<dl>
								{#if selected.sheet}<dt>Sheet</dt>
									<dd>{selected.sheet.name}</dd>{/if}
								{#if selected.pcb}<dt>PCB</dt>
									<dd>
										{selected.pcb.layer} · {selected.pcb.x.toFixed(2)}, {selected.pcb.y.toFixed(2)}
									</dd>{/if}
								{#if selected.bom?.footprint || selected.pcb?.footprint}<dt>Footprint</dt>
									<dd>{selected.bom?.footprint || selected.pcb?.footprint}</dd>{/if}
								{#if selected.bom?.parameters?.Manufacturer}<dt>Manufacturer</dt>
									<dd>{selected.bom.parameters.Manufacturer}</dd>{/if}
								{#if selected.bom?.parameters?.PartNumber}<dt>Part number</dt>
									<dd>{selected.bom.parameters.PartNumber}</dd>{/if}
								{#if selected.nets.length}<dt>Nets</dt>
									<dd>{selected.nets.join(', ')}</dd>{/if}
							</dl>
							<div class="presence">
								<button
									class:present={selected.bom}
									disabled={!selected.bom}
									onclick={() => openReviewChange(selected.designator, 'bom')}>BOM</button
								>
								<button
									class:present={selected.schematic}
									disabled={!selected.schematic}
									onclick={() => openReviewChange(selected.designator, 'schematic')}>SCH</button
								>
								<button
									class:present={selected.pcb}
									disabled={!selected.pcb}
									onclick={() => openReviewChange(selected.designator, 'pcb')}>PCB</button
								>
							</div>
							{#if projectStore.mode === 'compare' && selectedReviewChange}
								<div class="review-note">
									<div>
										<strong>Review note</strong>
										<button onclick={() => toggleReviewed(selectedReviewChange.key)}>
											{reviewedChanges.has(selectedReviewChange.key)
												? '✓ Reviewed'
												: 'Mark reviewed'}
										</button>
									</div>
									<textarea
										rows="3"
										placeholder="Decision, verification or follow-up…"
										value={reviewNotes[selectedReviewChange.key] ?? ''}
										oninput={(event) =>
											updateReviewNote(
												selectedReviewChange.key,
												(event.currentTarget as HTMLTextAreaElement).value
											)}></textarea>
									<div class="snapshot-actions">
										<button onclick={() => captureReviewSnapshot(selectedReviewChange.key)}>
											{reviewSnapshots[selectedReviewChange.key]
												? 'Replace snapshot'
												: 'Capture view'}
										</button>
										{#if reviewSnapshots[selectedReviewChange.key]}
											<button onclick={() => removeReviewSnapshot(selectedReviewChange.key)}>
												Remove
											</button>
										{/if}
									</div>
									{#if reviewSnapshots[selectedReviewChange.key]}
										<figure class="review-snapshot">
											<img
												src={reviewSnapshots[selectedReviewChange.key].dataUrl}
												alt={`${selectedReviewChange.value} review snapshot`}
											/>
											<figcaption>
												{reviewSnapshots[selectedReviewChange.key].view} ·
												{new Date(
													reviewSnapshots[selectedReviewChange.key].capturedAt
												).toLocaleString()}
											</figcaption>
										</figure>
									{/if}
								</div>
							{/if}
						</section>
					{/if}
				</aside>
			{/if}

			<section class="panel">
				{#if projectStore.activeTab === 'bom'}
					<BomDiffTable />
				{:else if projectStore.activeTab === 'pcb'}
					<PcbDiffCanvas />
				{:else if projectStore.activeTab === 'schematic'}
					<SchematicDiffCanvas />
				{/if}
			</section>
		</section>
	{/if}
</main>

{#if commandOpen}
	<div class="command-backdrop" role="presentation" onclick={closeCommands}>
		<dialog
			open
			class="command-palette"
			aria-label="Command palette"
			onclick={(event) => event.stopPropagation()}
		>
			<div class="command-input">
				<span>⌕</span>
				<input
					bind:this={commandInput}
					placeholder="Component, net or action…"
					bind:value={commandQuery}
				/>
				<kbd>Esc</kbd>
			</div>
			<div class="command-results">
				<div class="command-actions">
					{#if window.altiumDiff}
						<button
							onclick={() => {
								closeCommands();
								void openNativeFiles('A');
							}}
						>
							<span>Open project / version A</span>
							<small>Ctrl O</small>
						</button>
						<button
							onclick={() => {
								closeCommands();
								void openNativeFiles('B');
							}}
						>
							<span>Open version B</span>
							<small>Ctrl Shift O</small>
						</button>
					{/if}
					<button
						onclick={() => {
							projectStore.minimalUi = !projectStore.minimalUi;
							closeCommands();
						}}
					>
						<span>{projectStore.minimalUi ? 'Show advanced tools' : 'Return to minimal mode'}</span>
						<small>Appearance</small>
					</button>
					<button
						onclick={() => {
							closeCommands();
							helpOpen = true;
						}}
					>
						<span>Help & keyboard shortcuts</span>
						<small>F1</small>
					</button>
					{#if isReady}
						<button
							onclick={() => {
								sidebarCollapsed = !sidebarCollapsed;
								closeCommands();
							}}
						>
							<span>{sidebarCollapsed ? 'Show inspector' : 'Focus canvas'}</span>
							<small>Layout</small>
						</button>
						{#each tabs.filter((tab) => projectStore.availableTabs.includes(tab.id)) as tab, index}
							<button
								onclick={() => {
									projectStore.activeTab = tab.id;
									closeCommands();
								}}
							>
								<span
									>Open {projectStore.mode === 'view'
										? tab.label.replace(' Diff', '')
										: tab.label}</span
								>
								<small>Alt {index + 1}</small>
							</button>
						{/each}
					{/if}
				</div>
				{#if commandQuery.trim()}
					{#if commandComponents.length > 0}
						<h4>Components</h4>
						{#each commandComponents as component}
							<button
								class="command-result"
								onclick={() => commandSelectComponent(component.designator)}
							>
								<strong>{component.designator}</strong>
								<span
									>{component.bom?.comment ||
										component.schematic?.comment ||
										component.pcb?.comment ||
										component.category}</span
								>
							</button>
						{/each}
					{/if}
					{#if commandNets.length > 0}
						<h4>Nets</h4>
						{#each commandNets as net}
							<button class="command-result" onclick={() => commandSelectNet(net)}>
								<strong>{net}</strong><span>Electrical net</span>
							</button>
						{/each}
					{/if}
					{#if commandComponents.length === 0 && commandNets.length === 0}
						<p>No matching component or net.</p>
					{/if}
				{/if}
			</div>
		</dialog>
	</div>
{/if}

{#if helpOpen}
	<div class="help-backdrop" role="presentation" onclick={() => (helpOpen = false)}>
		<dialog
			open
			class="help-dialog"
			aria-label="Altium Diff Studio help"
			onclick={(event) => event.stopPropagation()}
		>
			<header>
				<div>
					<strong>Altium Diff Studio</strong>
					<span>Help & keyboard shortcuts</span>
				</div>
				<button aria-label="Close help" onclick={() => (helpOpen = false)}>×</button>
			</header>
			<div class="help-content">
				<section>
					<h3>Keyboard</h3>
					<dl class="shortcut-list">
						<dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt>
						<dd>Open the command palette</dd>
						<dt><kbd>Ctrl</kbd> <kbd>N</kbd></dt>
						<dd>Start a new workspace</dd>
						<dt><kbd>Ctrl</kbd> <kbd>O</kbd></dt>
						<dd>Open project or version A</dd>
						<dt><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd></dt>
						<dd>Open version B</dd>
						<dt><kbd>Ctrl</kbd> <kbd>.</kbd></dt>
						<dd>Show or hide advanced tools</dd>
						<dt><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>F</kbd></dt>
						<dd>Focus canvas or show inspector</dd>
						<dt><kbd>Alt</kbd> <kbd>1</kbd></dt>
						<dd>Open PCB view</dd>
						<dt><kbd>Alt</kbd> <kbd>2</kbd></dt>
						<dd>Open schematic view</dd>
						<dt><kbd>Alt</kbd> <kbd>3</kbd></dt>
						<dd>Open BOM view</dd>
						<dt><kbd>M</kbd></dt>
						<dd>Mirror the PCB horizontally</dd>
						<dt><kbd>F1</kbd></dt>
						<dd>Open this help</dd>
						<dt><kbd>Esc</kbd></dt>
						<dd>Close dialogs</dd>
					</dl>
				</section>
				<section>
					<h3>Canvas controls</h3>
					<ul>
						<li>Mouse wheel: zoom around the pointer.</li>
						<li>Drag: pan the PCB or schematic.</li>
						<li>Click a component: select and inspect it.</li>
						<li>Click a terminal or route: select its net.</li>
						<li><b>Fit</b>: return to the complete view.</li>
					</ul>
				</section>
				<section>
					<h3>Review workflow</h3>
					<ul>
						<li>Load one export to inspect it, or A and B to compare them.</li>
						<li>Use the global review list to navigate PCB, schematic and BOM changes.</li>
						<li>Mark items as reviewed and attach decisions or follow-up notes.</li>
						<li>Review progress is restored automatically for the same project pair.</li>
						<li>Export an HTML report when the review is ready to share.</li>
					</ul>
				</section>
				<section>
					<h3>Supported files</h3>
					<p>Altium Diff Studio JSON exports, schematic DXF files and Altium Smart PDF files.</p>
					<p>Import diagnostics report missing metadata, incomplete exports and invalid files.</p>
				</section>
				<section>
					<h3>Privacy</h3>
					<p>
						Projects are processed locally. Review notes and preferences are stored on this
						computer; no project data is uploaded by the application.
					</p>
				</section>
			</div>
			<footer>
				<span>Version 0.0.1</span>
				<button onclick={() => (helpOpen = false)}>Close</button>
			</footer>
		</dialog>
	</div>
{/if}
