<script lang="ts">
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import FabricationViewer from '$lib/components/FabricationViewer.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore, type ProjectViewerTab } from '$lib/state/viewerStore.svelte';

	const selected = $derived(projectStore.selectedA);
	const viewerTabs: Array<{ id: ProjectViewerTab; label: string }> = [
		{ id: 'pcb', label: 'PCB' },
		{ id: 'schematic', label: 'SCH' },
		{ id: 'gerber', label: 'FAB' },
		{ id: '3d', label: '3D' },
		{ id: 'bom', label: 'BOM' }
	];

	const availableViewerTabs = $derived.by(() => ({
		schematic:
			!!projectStore.projectA.schematic ||
			!!projectStore.projectB.schematic ||
			projectStore.filesA.some((file) => file.doc.type === 'schematic') ||
			projectStore.filesB.some((file) => file.doc.type === 'schematic') ||
			projectStore.dxfA.length > 0 ||
			projectStore.dxfB.length > 0 ||
			!!projectStore.pdfA ||
			!!projectStore.pdfB,
		pcb:
			!!projectStore.projectA.pcb ||
			!!projectStore.projectB.pcb ||
			projectStore.filesA.some((file) => file.doc.type === 'pcb') ||
			projectStore.filesB.some((file) => file.doc.type === 'pcb'),
		gerber: projectStore.gerberA.length > 0 || projectStore.odbA.length > 0,
		'3d': false,
		bom:
			!!projectStore.projectA.bom ||
			!!projectStore.projectB.bom ||
			projectStore.filesA.some((file) => file.doc.type === 'bom') ||
			projectStore.filesB.some((file) => file.doc.type === 'bom')
	}));
	const viewerPreferenceFiles = $derived.by(() => [
		...projectStore.filesA,
		...(projectStore.pdfA ? [projectStore.pdfA] : []),
		...projectStore.dxfA,
		...projectStore.gerberA,
		...projectStore.odbA
	]);
	const visibleViewerTabs = $derived(
		viewerTabs.filter(
			(tab) =>
				tab.id === 'pcb' ||
				tab.id === 'schematic' ||
				availableViewerTabs[tab.id] ||
				tab.id === viewerStore.projectViewerTab
		)
	);

	$effect(() => {
		viewerStore.restoreProjectViewerTab(viewerPreferenceFiles, availableViewerTabs);
	});

	$effect(() => {
		viewerStore.ensureProjectViewerTab(availableViewerTabs);
	});

	$effect(() => {
		viewerStore.persistProjectViewerTab(viewerPreferenceFiles, availableViewerTabs);
	});

	function openTab(tab: ProjectViewerTab) {
		viewerStore.projectViewerTab = tab;
		if (tab === 'pcb' || tab === 'schematic' || tab === 'bom') projectStore.activeTab = tab;
	}
</script>

<section class="viewer-area">
	<header class="viewer-topbar">
		<div class="selection-summary">
			<strong>{selected?.designator ?? 'Project'}</strong>
			<span>
				{selected
					? selected.bom?.comment ||
						selected.schematic?.comment ||
						selected.pcb?.comment ||
						selected.category
					: localeStore.t('host.localViewer')}
			</span>
		</div>
		<nav aria-label={localeStore.t('host.tabsAria')}>
			{#each visibleViewerTabs as tab}
				<button
					class:active={viewerStore.projectViewerTab === tab.id}
					disabled={!availableViewerTabs[tab.id]}
					onclick={() => openTab(tab.id)}>{tab.label}</button
				>
			{/each}
		</nav>
	</header>

	<div class="viewer-stage">
		{#if viewerStore.projectViewerTab === 'pcb' && availableViewerTabs.pcb}
			<PcbDiffCanvas />
		{:else if viewerStore.projectViewerTab === 'schematic' && availableViewerTabs.schematic}
			<SchematicDiffCanvas />
		{:else if viewerStore.projectViewerTab === 'gerber' && availableViewerTabs.gerber}
			<FabricationViewer files={projectStore.gerberA} odbPackages={projectStore.odbA} />
		{:else if viewerStore.projectViewerTab === 'bom' && availableViewerTabs.bom}
			<BomDiffTable />
		{:else}
			<div class="empty-view">
				<strong>{viewerStore.projectViewerTab.toUpperCase()}</strong>
				<span>{localeStore.t('host.viewPending')}</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.viewer-area {
		display: grid;
		grid-template-rows: 52px minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
	}

	.viewer-topbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) max-content;
		align-items: center;
		gap: 14px;
		min-height: 52px;
		overflow: hidden;
		border-bottom: 1px solid #d7dce3;
		background: #2a2d30;
		color: #ffffff;
		padding: 0 14px;
	}

	.selection-summary {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.selection-summary strong {
		font-size: 0.88rem;
	}

	.selection-summary span {
		color: #9ca3af;
		font-size: 0.72rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.viewer-topbar nav {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		max-width: 100%;
		min-width: max-content;
		height: 36px;
		overflow-x: auto;
		overflow-y: hidden;
		border-radius: 7px;
		background: #202326;
		padding: 3px;
		white-space: nowrap;
	}

	.viewer-topbar nav button {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		min-width: 64px;
		height: 30px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: #d1d5db;
		font-size: 0.78rem;
		font-weight: 900;
		line-height: 1;
		padding: 0 10px;
	}

	.viewer-topbar nav button.active {
		background: #3b3f43;
		box-shadow: inset 0 -2px 0 #f97316;
		color: #ffffff;
	}

	.viewer-topbar nav button:disabled {
		cursor: default;
		opacity: 0.38;
	}

	.viewer-stage {
		min-width: 0;
		min-height: 0;
		background: #eef0ed;
	}

	.empty-view {
		display: grid;
		place-content: center;
		gap: 8px;
		width: 100%;
		height: 100%;
		color: #475569;
		text-align: center;
	}

	.empty-view strong {
		color: #111827;
		font-size: 1.1rem;
	}
</style>
