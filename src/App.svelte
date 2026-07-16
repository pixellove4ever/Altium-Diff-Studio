<script lang="ts">
	import { onMount } from 'svelte';
	import type { AppCommand } from '../electron/preload';
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import FabricationViewer from '$lib/components/FabricationViewer.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import ProjectViewer from '$lib/components/ProjectViewer.svelte';
	import ProjectDropZone from '$lib/components/ProjectDropZone.svelte';
	import ReviewNoteCard from '$lib/components/review/ReviewNoteCard.svelte';
	import ReviewPanel from '$lib/components/review/ReviewPanel.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import { searchProject, type ComponentCategory } from '$lib/domain/project';
	import { inferProjectIdentity } from '$lib/domain/projectIdentity';
	import { projectStore, type WorkspaceTab } from '$lib/state/projectStore.svelte';
	import { importStore, type ImportDiagnostic } from '$lib/state/importStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { reviewStore } from '$lib/state/reviewStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';
	import { resolveLocale, type MessageKey } from '$lib/i18n';

	const tabs: Array<{ id: WorkspaceTab; labelKey: MessageKey }> = [
		{ id: 'pcb', labelKey: 'tab.pcb' },
		{ id: 'schematic', labelKey: 'tab.schematic' },
		{ id: 'bom', labelKey: 'tab.bom' },
		{ id: 'gerber', labelKey: 'tab.gerber' },
		{ id: 'report', labelKey: 'tab.report' }
	];
	const renderCompareSidebar = false;
	const projectFileAccept =
		'.json,.pdf,.dxf,.gbr,.ger,.pho,.art,.gtl,.gbl,.gts,.gbs,.gtp,.gbp,.gto,.gbo,.g1,.g2,.g3,.g4,.g5,.g6,.g7,.g8,.g9,.g10,.g11,.g12,.g13,.g14,.g15,.g16,.gm1,.gm2,.gm3,.gm4,.gm5,.gm6,.gm7,.gm8,.gm9,.gm10,.gm11,.gm12,.gm13,.gm14,.gm15,.gm16,.gd1,.gg1,.apr,.gko,.gml,.drl,.xln,.odb,.odb++,.tgz,.tar,.gz,.zip,application/json,application/pdf';

	const isReady = $derived(projectStore.isReady);
	const hasLoadedA = $derived(
		projectStore.filesA.length > 0 ||
			projectStore.pdfA !== null ||
			projectStore.dxfA.length > 0 ||
			projectStore.gerberA.length > 0 ||
			projectStore.odbA.length > 0
	);
	const hasLoadedB = $derived(
		projectStore.filesB.length > 0 ||
			projectStore.pdfB !== null ||
			projectStore.dxfB.length > 0 ||
			projectStore.gerberB.length > 0 ||
			projectStore.odbB.length > 0
	);
	const loadedSourceTypes = $derived.by(() => {
		const types = new Set(projectStore.filesA.map((file) => file.doc.type));
		for (const file of projectStore.filesB) types.add(file.doc.type);
		return types;
	});
	type SourceStatus = {
		id: 'schematic' | 'bom' | 'pcb' | 'dxf' | 'pdf' | 'gerber' | 'report';
		label: string;
		loaded: boolean;
	};
	const sourceStatus = $derived.by<SourceStatus[]>(() => {
		const sources: SourceStatus[] = [
			{
				id: 'schematic',
				label: 'LOGIC',
				loaded:
					loadedSourceTypes.has('schematic') ||
					!!projectStore.projectA.schematic ||
					!!projectStore.projectB.schematic
			},
			{
				id: 'bom',
				label: 'BOM',
				loaded:
					loadedSourceTypes.has('bom') || !!projectStore.projectA.bom || !!projectStore.projectB.bom
			},
			{
				id: 'pcb',
				label: 'PCB',
				loaded:
					loadedSourceTypes.has('pcb') || !!projectStore.projectA.pcb || !!projectStore.projectB.pcb
			},
			{
				id: 'dxf',
				label: 'DXF',
				loaded: projectStore.dxfA.length > 0 || projectStore.dxfB.length > 0
			}
		];
		if (projectStore.mode === 'compare') {
			sources.push({
				id: 'gerber',
				label: 'GBR',
				loaded: projectStore.gerberA.length > 0 || projectStore.gerberB.length > 0
			});
			sources.push({
				id: 'report',
				label: 'REPORT',
				loaded: true
			});
		} else {
			sources.push(
				{
					id: 'pdf',
					label: 'PDF',
					loaded: !!projectStore.pdfA || !!projectStore.pdfB
				},
				{
					id: 'gerber',
					label: 'GBR',
					loaded:
						projectStore.gerberA.length > 0 ||
						projectStore.gerberB.length > 0 ||
						projectStore.odbA.length > 0 ||
						projectStore.odbB.length > 0
				}
			);
		}
		return sources;
	});
	const baselineSummary = $derived(
		[
			projectStore.filesA.length > 0 ? `${projectStore.filesA.length} ADS JSON` : '',
			projectStore.pdfA ? 'Smart PDF' : '',
			projectStore.dxfA.length > 0 ? `${projectStore.dxfA.length} DXF` : '',
			projectStore.gerberA.length > 0 ? `${projectStore.gerberA.length} Gerber` : '',
			projectStore.odbA.length > 0 ? `${projectStore.odbA.length} ODB++` : ''
		]
			.filter(Boolean)
			.join(' · ')
	);
	const filesForIdentityA = $derived([
		...projectStore.filesA,
		...(projectStore.pdfA ? [projectStore.pdfA] : []),
		...projectStore.dxfA,
		...projectStore.gerberA,
		...projectStore.odbA
	]);
	const filesForIdentityB = $derived([
		...projectStore.filesB,
		...(projectStore.pdfB ? [projectStore.pdfB] : []),
		...projectStore.dxfB,
		...projectStore.gerberB,
		...projectStore.odbB
	]);
	const projectIdentityA = $derived(inferProjectIdentity(filesForIdentityA, 'Version A'));
	const projectIdentityB = $derived(inferProjectIdentity(filesForIdentityB, 'Version B'));
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
	const categories: Array<{ id: ComponentCategory; labelKey: MessageKey }> = [
		{ id: 'all', labelKey: 'app.categoryAll' },
		{ id: 'resistor', labelKey: 'app.categoryResistors' },
		{ id: 'capacitor', labelKey: 'app.categoryCapacitors' },
		{ id: 'ic', labelKey: 'app.categoryIcs' },
		{ id: 'connector', labelKey: 'app.categoryConnectors' },
		{ id: 'power', labelKey: 'app.categoryPower' },
		{ id: 'testpoint', labelKey: 'app.categoryTestpoints' }
	];
	let modeChosen = $state(false);
	let commandOpen = $state(false);
	let commandQuery = $state('');
	let commandInput = $state<HTMLInputElement | null>(null);
	let helpOpen = $state(false);
	let helpDialog = $state<HTMLDialogElement | null>(null);
	let homeDragMode = $state<'view' | 'compare' | null>(null);
	const selectedReviewChange = $derived(reviewStore.selectedComponentChange);
	const selectedNetReviewChange = $derived(reviewStore.selectedNetChange);
	const commandComponents = $derived(searchProject(activeIndex, commandQuery, 'all').slice(0, 7));
	const commandNets = $derived(
		commandQuery.trim()
			? activeIndex.nets
					.filter((net) => net.toLowerCase().includes(commandQuery.trim().toLowerCase()))
					.slice(0, 7)
			: []
	);
	type DiagnosticRow = ImportDiagnostic & { count: number };
	const compactDiagnosticMessage = (message: string) => message.replace(/\[[0-9]+\]/g, '[*]');
	const diagnosticRows = $derived.by(() => {
		if (!viewerStore.minimalUi)
			return importStore.importDiagnostics.map((diagnostic) => ({ ...diagnostic, count: 1 }));
		const grouped = new Map<string, DiagnosticRow>();
		for (const diagnostic of importStore.importDiagnostics) {
			if (diagnostic.severity === 'info') continue;
			const message = compactDiagnosticMessage(diagnostic.message);
			const key = [diagnostic.side, diagnostic.file, diagnostic.severity, message].join('|');
			const current = grouped.get(key);
			if (current) current.count += 1;
			else grouped.set(key, { ...diagnostic, message, count: 1 });
		}
		return Array.from(grouped.values()).map((diagnostic) =>
			diagnostic.count > 1
				? { ...diagnostic, message: `${diagnostic.message} (${diagnostic.count} occurrences)` }
				: diagnostic
		);
	});
	const diagnosticProblems = $derived(
		importStore.importDiagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length
	);
	const visibleDiagnosticRows = $derived(
		viewerStore.minimalUi ? diagnosticRows.slice(0, 5) : diagnosticRows
	);
	const hiddenDiagnosticRows = $derived(
		Math.max(0, diagnosticRows.length - visibleDiagnosticRows.length)
	);
	const importing = $derived(importStore.loadingSide !== null);
	const workspaceVersionSummary = $derived.by(() => {
		const versions = new Set(
			[...projectStore.filesA, ...projectStore.filesB]
				.flatMap((file) => [file.doc.exportMeta?.scriptVersion, file.doc.exportMeta?.schemaVersion])
				.filter((version): version is string => !!version)
		);
		return [`App ${__APP_VERSION__}`, ...versions].join(' · ');
	});

	onMount(() => {
		localeStore.set(resolveLocale(window.localStorage.getItem('ads:locale') ?? 'fr'));
		viewerStore.hydrateMinimalUi(window.localStorage);
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
			else if (command === 'toggle-tools') viewerStore.toggleMinimalUi();
			else if (command === 'set-locale-fr') localeStore.set('fr');
			else if (command === 'set-locale-en') localeStore.set('en');
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
			viewerStore.persistMinimalUi(window.localStorage);
		}
	});

	$effect(() => {
		if (typeof window !== 'undefined') reviewStore.restore(window.localStorage);
	});

	$effect(() => {
		if (typeof window !== 'undefined') reviewStore.persist(window.localStorage);
	});

	$effect(() => {
		if (commandOpen && commandInput) {
			queueMicrotask(() => commandInput?.focus());
		}
	});

	$effect(() => {
		if (helpOpen && helpDialog) {
			queueMicrotask(() => helpDialog?.querySelector<HTMLButtonElement>('button')?.focus());
		}
	});

	function trapDialogFocus(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const dialog = event.currentTarget as HTMLDialogElement;
		const focusable = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => element.offsetParent !== null);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable.at(-1)!;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function chooseMode(mode: 'compare' | 'view') {
		importStore.reset();
		projectStore.setMode(mode);
		viewerStore.resetSchematicRenderPreference();
		modeChosen = true;
	}

	async function importHomeFiles(mode: 'compare' | 'view', files: FileList | File[] | null) {
		if (!files || files.length === 0) return;
		importStore.reset();
		projectStore.setMode(mode);
		viewerStore.resetSchematicRenderPreference();
		await importStore.loadBrowserFiles('A', files);
		modeChosen = mode === 'compare' || projectStore.isReady;
	}

	function onHomeInput(mode: 'compare' | 'view', event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		void importHomeFiles(mode, files);
	}

	function onHomeDrop(mode: 'compare' | 'view', event: DragEvent) {
		event.preventDefault();
		homeDragMode = null;
		void importHomeFiles(mode, event.dataTransfer?.files ?? null);
	}

	function returnHome() {
		importStore.reset();
		projectStore.reset();
		viewerStore.resetSchematicRenderPreference();
		modeChosen = false;
		reviewStore.reset();
	}

	function exportDiagnostics() {
		const report = {
			generatedAt: new Date().toISOString(),
			appVersion: __APP_VERSION__,
			testedAltiumVersion: '26.7.1',
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
			diagnostics: importStore.importDiagnostics
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
			importStore.reset();
			projectStore.setMode(side === 'A' ? 'view' : 'compare');
			viewerStore.resetSchematicRenderPreference();
			modeChosen = true;
		} else if (side === 'B' && projectStore.mode !== 'compare') {
			projectStore.mode = 'compare';
		}
		await importStore.loadNativeFiles(side, files);
	}

	function startComparisonFromViewer() {
		projectStore.mode = 'compare';
		if (window.altiumDiff) void openNativeFiles('B');
	}

	function tabLabel(tab: { id: WorkspaceTab; labelKey: MessageKey }) {
		if (projectStore.mode === 'view')
			return tab.id === 'schematic' ? 'LOGIC' : tab.id.toUpperCase();
		return localeStore.t(tab.labelKey);
	}

	function supplementalImportSide() {
		if (projectStore.mode === 'view') return 'A';
		return hasLoadedB ? 'B' : 'A';
	}

	function isSourceLoaded(sourceId: SourceStatus['id']) {
		return sourceStatus.find((source) => source.id === sourceId)?.loaded ?? false;
	}

	async function loadMissingSource(source: SourceStatus) {
		const side = supplementalImportSide();
		const files = await window.altiumDiff?.chooseProjectFiles();
		if (!files?.length) return;
		await importStore.loadNativeFiles(side, files);
		if (!isSourceLoaded(source.id)) {
			projectStore.warning = `${source.label} is still missing. Select the matching export file or folder.`;
		}
	}

	function activateSourcePage(sourceId: SourceStatus['id']) {
		if (sourceId === 'report') {
			projectStore.activeTab = 'report';
			return;
		}
		if (sourceId === 'pcb') {
			viewerStore.projectViewerTab = 'pcb';
			projectStore.activeTab = 'pcb';
			return;
		}
		if (sourceId === 'bom') {
			viewerStore.projectViewerTab = 'bom';
			projectStore.activeTab = 'bom';
			return;
		}
		if (sourceId === 'gerber') {
			viewerStore.projectViewerTab = 'gerber';
			if (projectStore.mode === 'compare') projectStore.activeTab = 'gerber';
			return;
		}
		viewerStore.projectViewerTab = 'schematic';
		projectStore.activeTab = 'schematic';
		viewerStore.setSchematicRenderMode(
			sourceId === 'pdf' ? 'pdf' : sourceId === 'dxf' ? 'dxf' : 'logical'
		);
	}

	async function openSourcePage(source: SourceStatus) {
		if (!source.loaded) {
			await loadMissingSource(source);
			if (!isSourceLoaded(source.id)) return;
		}
		activateSourcePage(source.id);
	}

	function isSourcePageActive(source: SourceStatus) {
		if (projectStore.mode === 'compare') {
			if (source.id === 'schematic')
				return (
					projectStore.activeTab === 'schematic' &&
					viewerStore.schematicRenderMode !== 'dxf' &&
					viewerStore.schematicRenderMode !== 'pdf'
				);
			if (source.id === 'dxf')
				return projectStore.activeTab === 'schematic' && viewerStore.schematicRenderMode === 'dxf';
			if (source.id === 'pcb') return projectStore.activeTab === 'pcb';
			if (source.id === 'bom') return projectStore.activeTab === 'bom';
			if (source.id === 'gerber') return projectStore.activeTab === 'gerber';
			if (source.id === 'report') return projectStore.activeTab === 'report';
		}
		if (source.id === 'pdf')
			return (
				viewerStore.projectViewerTab === 'schematic' && viewerStore.schematicRenderMode === 'pdf'
			);
		if (source.id === 'dxf')
			return (
				viewerStore.projectViewerTab === 'schematic' && viewerStore.schematicRenderMode === 'dxf'
			);
		if (source.id === 'schematic')
			return (
				viewerStore.projectViewerTab === 'schematic' &&
				viewerStore.schematicRenderMode !== 'pdf' &&
				viewerStore.schematicRenderMode !== 'dxf'
			);
		if (source.id === 'gerber')
			return projectStore.mode === 'compare'
				? projectStore.activeTab === 'gerber'
				: viewerStore.projectViewerTab === 'gerber';
		if (source.id === 'report') return projectStore.activeTab === 'report';
		return viewerStore.projectViewerTab === source.id;
	}
</script>

<svelte:head>
	<title>Altium Diff Studio</title>
</svelte:head>

<main class:workspace={isReady} class:minimal={viewerStore.minimalUi}>
	{#if importStore.loadingSide}
		<div class="import-progress" role="status" aria-live="polite">
			<span class="import-spinner"></span>
			<div>
				<strong>{localeStore.t('app.loadingVersion', { side: importStore.loadingSide })}</strong>
				<span>{importStore.loadingMessage}</span>
			</div>
			<button onclick={() => importStore.cancelImport()}>{localeStore.t('app.cancel')}</button>
		</div>
	{/if}
	<header class="topbar">
		{#if modeChosen}
			<div class="source-status" aria-label={localeStore.t('app.sourcesStatus')}>
				<div class="source-icons">
					{#each sourceStatus as source}
						<button
							type="button"
							class="source-chip"
							class:loaded={source.loaded}
							class:missing={!source.loaded}
							class:active={isSourcePageActive(source)}
							class:report-chip={source.id === 'report'}
							title={`${source.label} - ${
								source.loaded
									? localeStore.t('app.sourceLoaded')
									: `${localeStore.t('app.sourceMissing')} - ${localeStore.t('app.sourceLoadMissing')}`
							}`}
							onclick={() => void openSourcePage(source)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								{#if source.id === 'schematic'}
									<path d="M5 7h5m4 0h5M9 7a3 3 0 1 0 6 0M7 17h10m-5-7v7" />
								{:else if source.id === 'bom'}
									<path d="M7 7h10M7 12h10M7 17h6M4 7h.01M4 12h.01M4 17h.01" />
								{:else if source.id === 'pcb'}
									<path d="M6 5h12v14H6zM9 8h2v2H9zM14 14h2v2h-2zM11 9h4m-5 5h4" />
								{:else if source.id === 'dxf'}
									<path d="M5 18 18 5m-7 0h7v7M6 7l4 4m4 4 4 4" />
								{:else if source.id === 'gerber'}
									<path d="M5 6h14M5 12h14M5 18h14M8 4v16M16 4v16" />
								{:else if source.id === 'report'}
									<path d="M7 3h10v18H7zM10 7h4M10 11h4M10 15h2" />
								{:else}
									<path d="M7 3h7l4 4v14H7zM14 3v5h5M9 14h6M9 17h4" />
								{/if}
							</svg>
							<span>{source.label}</span>
						</button>
					{/each}
				</div>
				<p class="source-identity">
					{#if projectStore.mode === 'compare'}
						Version A · {projectIdentityA.label}
						{#if hasLoadedB}
							/ Version B · {projectIdentityB.label}{/if}
					{:else}
						{projectIdentityA.label}
					{/if}
				</p>
			</div>
		{:else}
			<div class="brand-title">
				<h1>◈ Altium Diff Studio</h1>
				<p>{localeStore.t('app.tagline.view')}</p>
			</div>
		{/if}
		{#if modeChosen}
			<div class="topbar-actions">
				{#if isReady}
					{#if diagnosticProblems > 0}
						<span class="diagnostic-badge" title={localeStore.t('app.importDiagnostics')}
							>{diagnosticProblems}</span
						>
					{/if}
					{#if projectStore.mode === 'view'}
						<button
							class="compare-action"
							title={localeStore.t('app.compareThisProject')}
							onclick={startComparisonFromViewer}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M7 7h10l-3-3m3 3-3 3" />
								<path d="M17 17H7l3 3m-3-3 3-3" />
							</svg>
							{localeStore.t('app.compareTitle')}
						</button>
					{/if}
					<button
						class:active={!viewerStore.minimalUi}
						title={localeStore.t('app.showHideAdv')}
						onclick={() => (viewerStore.minimalUi = !viewerStore.minimalUi)}
					>
						{viewerStore.minimalUi ? localeStore.t('app.tools') : localeStore.t('app.less')}
					</button>
				{/if}
				<button onclick={returnHome}>{localeStore.t('app.newWorkspace')}</button>
			</div>
		{/if}
	</header>

	{#if projectStore.error}
		<section class="error">{projectStore.error}</section>
	{/if}
	{#if projectStore.warning && !importing}
		<section class="warning">{projectStore.warning}</section>
	{/if}
	{#if importStore.importDiagnostics.length > 0 && !viewerStore.minimalUi && !importing}
		<details class="diagnostics-panel">
			<summary>
				<span>{localeStore.t('app.importDiagnostics')}</span>
				<b
					>{diagnosticProblems > 0
						? localeStore.t('app.issuesCount', { count: diagnosticProblems })
						: localeStore.t('app.validated')}</b
				>
			</summary>
			<div>
				<p class="info">
					<strong>{localeStore.t('app.versions')}</strong>
					<span>{workspaceVersionSummary}</span>
				</p>
				{#each visibleDiagnosticRows as diagnostic}
					<p class={diagnostic.severity}>
						<strong>{diagnostic.side} · {diagnostic.file}</strong>
						<span>{diagnostic.message}</span>
					</p>
				{/each}
				{#if hiddenDiagnosticRows > 0}
					<p class="info">
						<strong>{localeStore.t('app.more')}</strong>
						<span>{localeStore.t('app.moreGroupedHidden', { count: hiddenDiagnosticRows })}</span>
					</p>
				{/if}
				<button onclick={exportDiagnostics}>{localeStore.t('app.exportDiagnostics')}</button>
			</div>
		</details>
	{/if}

	{#if !isReady}
		<section class="compatibility-notice" role="note">
			<strong>{localeStore.t('app.compatibility.title')}</strong>
			{localeStore.t('app.compatibility.message')}
		</section>
	{/if}

	{#if !modeChosen}
		<section class="mode-choice">
			<div
				class="mode-card"
				class:dragging={homeDragMode === 'view'}
				role="group"
				aria-label={localeStore.t('mode.view.title')}
				ondragenter={() => (homeDragMode = 'view')}
				ondragleave={() => (homeDragMode = null)}
				ondragover={(event) => event.preventDefault()}
				ondrop={(event) => onHomeDrop('view', event)}
			>
				<div class="mode-icon" aria-hidden="true">+</div>
				<div>
					<strong>{localeStore.t('mode.view.title')}</strong>
					<span>{localeStore.t('mode.view.description')}</span>
				</div>
				<p>{localeStore.t('mode.dropHint')}</p>
				<div class="mode-actions">
					<label>
						<input
							type="file"
							accept={projectFileAccept}
							multiple
							onchange={(event) => onHomeInput('view', event)}
						/>
						<span
							><svg viewBox="0 0 24 24" aria-hidden="true"
								><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></svg
							>{localeStore.t('mode.files')}</span
						>
					</label>
					<label>
						<input
							type="file"
							accept={projectFileAccept}
							multiple
							webkitdirectory
							onchange={(event) => onHomeInput('view', event)}
						/>
						<span
							><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg
							>{localeStore.t('mode.folder')}</span
						>
					</label>
				</div>
			</div>
			<div
				class="mode-card"
				class:dragging={homeDragMode === 'compare'}
				role="group"
				aria-label={localeStore.t('mode.compare.title')}
				ondragenter={() => (homeDragMode = 'compare')}
				ondragleave={() => (homeDragMode = null)}
				ondragover={(event) => event.preventDefault()}
				ondrop={(event) => onHomeDrop('compare', event)}
			>
				<div class="mode-icon" aria-hidden="true">+</div>
				<div>
					<strong>{localeStore.t('mode.compare.title')}</strong>
					<span>{localeStore.t('mode.compare.description')}</span>
				</div>
				<p>{localeStore.t('mode.compareDropHint')}</p>
				<div class="mode-actions">
					<label>
						<input
							type="file"
							accept={projectFileAccept}
							multiple
							onchange={(event) => onHomeInput('compare', event)}
						/>
						<span
							><svg viewBox="0 0 24 24" aria-hidden="true"
								><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></svg
							>{localeStore.t('mode.files')}</span
						>
					</label>
					<label>
						<input
							type="file"
							accept={projectFileAccept}
							multiple
							webkitdirectory
							onchange={(event) => onHomeInput('compare', event)}
						/>
						<span
							><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg
							>{localeStore.t('mode.folder')}</span
						>
					</label>
				</div>
			</div>
		</section>
	{:else if !isReady}
		<section class="landing" class:importing>
			{#if projectStore.mode === 'compare' && hasLoadedA}
				<section class="loaded-baseline" aria-label="Loaded baseline">
					<header>
						<span>Version A · {projectIdentityA.label}</span>
						<h2>{localeStore.t('app.baselineLoaded')}</h2>
					</header>
					<p>{baselineSummary || localeStore.t('app.projectDataReady')}</p>
					<button onclick={() => chooseMode('view')}>{localeStore.t('app.backToViewer')}</button>
				</section>
			{:else}
				<ProjectDropZone
					side="A"
					title={projectStore.mode === 'view'
						? localeStore.t('app.projectExport')
						: localeStore.t('app.baselineExport')}
				/>
			{/if}
			{#if projectStore.mode === 'compare'}
				<ProjectDropZone side="B" title={localeStore.t('app.candidateExport')} />
			{/if}
		</section>
	{:else if projectStore.mode === 'view'}
		<ProjectViewer />
	{:else}
		<section class="workspace-grid compare-workspace">
			{#if renderCompareSidebar}
				<aside>
					{#if projectStore.mode === 'compare' && !viewerStore.minimalUi}
						<ReviewPanel />
					{/if}

					<div class="probe">
						<label for="designator">{localeStore.t('app.projectSearch')}</label>
						<input
							id="designator"
							placeholder={localeStore.t('app.searchPlaceholder')}
							bind:value={projectStore.searchQuery}
						/>
						{#if !viewerStore.minimalUi}
							<select bind:value={projectStore.componentCategory}>
								{#each categories as category}
									<option value={category.id}>{localeStore.t(category.labelKey)}</option>
								{/each}
							</select>
						{/if}
						{#if !viewerStore.minimalUi || projectStore.searchQuery.trim()}
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

					{#if projectStore.mode === 'compare' && selectedNetReviewChange && !viewerStore.minimalUi}
						<ReviewNoteCard change={selectedNetReviewChange} kind="net" />
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
									localeStore.t('app.noValue')}
							</p>
							<dl>
								{#if selected.sheet}<dt>{localeStore.t('app.sheet')}</dt>
									<dd>{selected.sheet.name}</dd>{/if}
								{#if selected.pcb}<dt>PCB</dt>
									<dd>
										{selected.pcb.layer} · {selected.pcb.x.toFixed(2)}, {selected.pcb.y.toFixed(2)}
									</dd>{/if}
								{#if selected.bom?.footprint || selected.pcb?.footprint}<dt>
										{localeStore.t('app.footprint')}
									</dt>
									<dd>{selected.bom?.footprint || selected.pcb?.footprint}</dd>{/if}
								{#if selected.parameters.Manufacturer}<dt>{localeStore.t('app.manufacturer')}</dt>
									<dd>{selected.parameters.Manufacturer}</dd>{/if}
								{#if selected.parameters.PartNumber || selected.parameters.MPN || selected.parameters['Manufacturer Part Number']}<dt
									>
										{localeStore.t('app.partNumber')}
									</dt>
									<dd>
										{selected.parameters.PartNumber ||
											selected.parameters.MPN ||
											selected.parameters['Manufacturer Part Number']}
									</dd>{/if}
								{#if selected.nets.length}<dt>{localeStore.t('app.nets')}</dt>
									<dd>{selected.nets.join(', ')}</dd>{/if}
							</dl>
							<div class="presence">
								<button
									class:present={selected.bom}
									disabled={!selected.bom}
									onclick={() => reviewStore.openChange(selected.designator, 'bom')}>BOM</button
								>
								<button
									class:present={selected.schematic}
									disabled={!selected.schematic}
									onclick={() => reviewStore.openChange(selected.designator, 'schematic')}
									>SCH</button
								>
								<button
									class:present={selected.pcb}
									disabled={!selected.pcb}
									onclick={() => reviewStore.openChange(selected.designator, 'pcb')}>PCB</button
								>
							</div>
							{#if projectStore.mode === 'compare' && selectedReviewChange && !viewerStore.minimalUi}
								<ReviewNoteCard change={selectedReviewChange} />
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
				{:else if projectStore.activeTab === 'gerber'}
					<FabricationViewer files={projectStore.gerberA} odbPackages={[]} />
				{:else if projectStore.activeTab === 'report'}
					<section class="report-view">
						<ReviewPanel />
						{#if selectedNetReviewChange}
							<ReviewNoteCard change={selectedNetReviewChange} kind="net" />
						{/if}
						{#if selectedReviewChange}
							<ReviewNoteCard change={selectedReviewChange} />
						{/if}
					</section>
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
			aria-label={localeStore.t('app.commandPaletteAria')}
			onclick={(event) => event.stopPropagation()}
			onkeydown={trapDialogFocus}
		>
			<div class="command-input">
				<span>⌕</span>
				<input
					bind:this={commandInput}
					placeholder={localeStore.t('app.actionPlaceholder')}
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
							<span>{localeStore.t('app.openProjA')}</span>
							<small>Ctrl O</small>
						</button>
						<button
							onclick={() => {
								closeCommands();
								void openNativeFiles('B');
							}}
						>
							<span>{localeStore.t('app.openProjB')}</span>
							<small>Ctrl Shift O</small>
						</button>
					{/if}
					<button
						onclick={() => {
							viewerStore.minimalUi = !viewerStore.minimalUi;
							closeCommands();
						}}
					>
						<span>
							{viewerStore.minimalUi
								? localeStore.t('app.showAdvTools')
								: localeStore.t('app.returnMinMode')}
						</span>
						<small>{localeStore.t('app.appearance')}</small>
					</button>
					<button
						onclick={() => {
							closeCommands();
							helpOpen = true;
						}}
					>
						<span>{localeStore.t('app.help')}</span>
						<small>F1</small>
					</button>
					{#if isReady}
						{#each tabs.filter((tab) => projectStore.availableTabs.includes(tab.id)) as tab, index}
							<button
								onclick={() => {
									projectStore.activeTab = tab.id;
									closeCommands();
								}}
							>
								<span>{localeStore.t('app.openTab', { tab: tabLabel(tab) })}</span>
								<small>Alt {index + 1}</small>
							</button>
						{/each}
					{/if}
				</div>
				{#if commandQuery.trim()}
					{#if commandComponents.length > 0}
						<h4>{localeStore.t('pcb.components')}</h4>
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
								<strong>{net}</strong><span>{localeStore.t('app.electricalNet')}</span>
							</button>
						{/each}
					{/if}
					{#if commandComponents.length === 0 && commandNets.length === 0}
						<p>{localeStore.t('app.searchNoMatch')}</p>
					{/if}
				{/if}
			</div>
		</dialog>
	</div>
{/if}

{#if helpOpen}
	<div class="help-backdrop" role="presentation" onclick={() => (helpOpen = false)}>
		<dialog
			bind:this={helpDialog}
			open
			class="help-dialog"
			aria-label={localeStore.t('app.helpTitle')}
			onclick={(event) => event.stopPropagation()}
			onkeydown={trapDialogFocus}
		>
			<header>
				<div>
					<strong>Altium Diff Studio</strong>
					<span>{localeStore.t('app.help')}</span>
				</div>
				<button aria-label="Close help" onclick={() => (helpOpen = false)}>×</button>
			</header>
			<div class="help-content">
				<section>
					<h3>{localeStore.t('app.keyboard')}</h3>
					<dl class="shortcut-list">
						<dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt>
						<dd>{localeStore.t('app.openCmdPalette')}</dd>
						<dt><kbd>Ctrl</kbd> <kbd>N</kbd></dt>
						<dd>{localeStore.t('app.startNewWorkspace')}</dd>
						<dt><kbd>Ctrl</kbd> <kbd>O</kbd></dt>
						<dd>{localeStore.t('app.openProjA')}</dd>
						<dt><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd></dt>
						<dd>{localeStore.t('app.openProjB')}</dd>
						<dt><kbd>Ctrl</kbd> <kbd>.</kbd></dt>
						<dd>{localeStore.t('app.showHideAdv')}</dd>
						<dt><kbd>Alt</kbd> <kbd>1</kbd></dt>
						<dd>{localeStore.t('app.openPcbView')}</dd>
						<dt><kbd>Alt</kbd> <kbd>2</kbd></dt>
						<dd>{localeStore.t('app.openSchView')}</dd>
						<dt><kbd>Alt</kbd> <kbd>3</kbd></dt>
						<dd>{localeStore.t('app.openBomView')}</dd>
						<dt><kbd>M</kbd></dt>
						<dd>{localeStore.t('app.mirrorPcbHoriz')}</dd>
						<dt><kbd>F1</kbd></dt>
						<dd>{localeStore.t('app.openHelp')}</dd>
						<dt><kbd>Esc</kbd></dt>
						<dd>{localeStore.t('app.closeDialogs')}</dd>
					</dl>
				</section>
				<section>
					<h3>{localeStore.t('app.canvasControls')}</h3>
					<ul>
						<li>{localeStore.t('app.mouseWheelZoom')}</li>
						<li>{localeStore.t('app.dragPan')}</li>
						<li>{localeStore.t('app.clickSelectComp')}</li>
						<li>{localeStore.t('app.clickSelectNet')}</li>
						<li>{localeStore.t('app.fitReturn')}</li>
					</ul>
				</section>
				<section>
					<h3>{localeStore.t('app.reviewWorkflow')}</h3>
					<ul>
						<li>{localeStore.t('app.loadOneInspect')}</li>
						<li>{localeStore.t('app.globalReviewList')}</li>
						<li>{localeStore.t('app.markReviewedNotes')}</li>
						<li>{localeStore.t('app.reviewRestored')}</li>
						<li>{localeStore.t('app.exportHtmlReady')}</li>
					</ul>
				</section>
				<section>
					<h3>{localeStore.t('app.supportedFiles')}</h3>
					<p>{localeStore.t('app.supportedFilesDesc')}</p>
					<p>{localeStore.t('app.diagDesc')}</p>
					<p class="compatibility-notice">
						<strong>{localeStore.t('app.compatibility.title')}</strong>
						{localeStore.t('app.compatibility.message')}
					</p>
				</section>
				<section>
					<h3>{localeStore.t('app.privacy')}</h3>
					<p>{localeStore.t('app.privacyDesc')}</p>
				</section>
			</div>
			<footer>
				<span>{localeStore.t('app.version', { version: __APP_VERSION__ })}</span>
				<button onclick={() => (helpOpen = false)}>{localeStore.t('app.close')}</button>
			</footer>
		</dialog>
	</div>
{/if}
