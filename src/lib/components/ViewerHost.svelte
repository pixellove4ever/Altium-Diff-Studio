<script lang="ts">
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import FabricationViewer from '$lib/components/FabricationViewer.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import { inferProjectIdentity } from '$lib/domain/projectIdentity';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';

	const selected = $derived(projectStore.selectedA);
	const projectIdentity = $derived(
		inferProjectIdentity([
			...projectStore.filesA,
			...(projectStore.pdfA ? [projectStore.pdfA] : []),
			...projectStore.dxfA,
			...projectStore.gerberA,
			...projectStore.odbA
		])
	);
	const availableViewerTabs = $derived.by(() => ({
		schematic:
			!!projectStore.projectA.schematic ||
			!!projectStore.projectB.schematic ||
			projectStore.filesA.some((file) => file.doc.type === 'schematic') ||
			projectStore.filesB.some((file) => file.doc.type === 'schematic') ||
			projectStore.dxfA.length > 0 ||
			projectStore.dxfB.length > 0 ||
			(projectStore.mode === 'view' && (!!projectStore.pdfA || !!projectStore.pdfB)),
		pcb:
			!!projectStore.projectA.pcb ||
			!!projectStore.projectB.pcb ||
			projectStore.filesA.some((file) => file.doc.type === 'pcb') ||
			projectStore.filesB.some((file) => file.doc.type === 'pcb'),
		gerber:
			projectStore.mode === 'view' &&
			(projectStore.gerberA.length > 0 || projectStore.odbA.length > 0),
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
	$effect(() => {
		viewerStore.restoreProjectViewerTab(viewerPreferenceFiles, availableViewerTabs);
	});

	$effect(() => {
		viewerStore.ensureProjectViewerTab(availableViewerTabs);
	});

	$effect(() => {
		viewerStore.persistProjectViewerTab(viewerPreferenceFiles, availableViewerTabs);
	});
</script>

<section class="viewer-area" class:no-topbar={viewerStore.projectViewerTab === 'schematic'}>
	{#if viewerStore.projectViewerTab !== 'schematic'}
		<header class="viewer-topbar">
			<div class="selection-summary">
				<strong>{selected?.designator ?? projectIdentity.name}</strong>
				<span>
					{selected
						? selected.bom?.comment ||
							selected.schematic?.comment ||
							selected.pcb?.comment ||
							selected.category
						: projectIdentity.version || localeStore.t('host.localViewer')}
				</span>
			</div>
		</header>
	{/if}

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

	.viewer-area.no-topbar {
		grid-template-rows: minmax(0, 1fr);
	}

	.viewer-topbar {
		display: flex;
		align-items: center;
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
