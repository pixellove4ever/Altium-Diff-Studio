<script lang="ts">
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import GerberViewer from '$lib/components/GerberViewer.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';

	let { onCompare }: { onCompare: () => void } = $props();

	type ViewerTab = 'schematic' | 'pcb' | 'gerber' | '3d' | 'bom';

	const components = $derived(projectStore.indexA.components);
	const selected = $derived(projectStore.selectedA);
	let viewerTab = $state<ViewerTab>('pcb');
	let query = $state('');

	const filteredComponents = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return components;
		return components.filter((component) => component.searchText.includes(needle));
	});

	const availableViewerTabs = $derived.by(() => ({
		schematic: !!projectStore.projectA.schematic,
		pcb: !!projectStore.projectA.pcb,
		gerber: projectStore.gerberA.length > 0 || projectStore.odbA.length > 0,
		'3d': false,
		bom: !!projectStore.projectA.bom
	}));

	$effect(() => {
		if (availableViewerTabs[viewerTab]) return;
		viewerTab =
			availableViewerTabs.pcb
				? 'pcb'
				: availableViewerTabs.schematic
					? 'schematic'
					: availableViewerTabs.bom
						? 'bom'
						: viewerTab;
	});

	function selectComponent(designator: string) {
		projectStore.selectDesignator(designator);
		if (projectStore.projectA.pcb) viewerTab = 'pcb';
		else if (projectStore.projectA.schematic) viewerTab = 'schematic';
	}

	function openTab(tab: ViewerTab) {
		viewerTab = tab;
		if (tab === 'pcb' || tab === 'schematic' || tab === 'bom') projectStore.activeTab = tab;
	}

	function toggleAdvanced(event: Event) {
		projectStore.minimalUi = !(event.currentTarget as HTMLInputElement).checked;
	}
</script>

<section class="project-viewer">
	<aside class="bom-rail" aria-label="Project BOM">
		<header>
			<div>
				<strong>BOM</strong>
				<span>{components.length} refs</span>
			</div>
			<label class="advanced-toggle">
				<input type="checkbox" checked={!projectStore.minimalUi} onchange={toggleAdvanced} />
				<span>Avance</span>
			</label>
		</header>
		<input class="bom-search" bind:value={query} placeholder="Reference, valeur, net..." />
		<div class="bom-list">
			{#each filteredComponents as component}
				<button
					class:selected={projectStore.selectedDesignator === component.designator}
					onclick={() => selectComponent(component.designator)}
				>
					<strong>{component.designator}</strong>
					<span>{component.bom?.comment || component.schematic?.comment || component.pcb?.comment || ''}</span>
				</button>
			{/each}
			{#if filteredComponents.length === 0}
				<p>Aucun composant.</p>
			{/if}
		</div>
	</aside>

	<section class="viewer-area">
		<header class="viewer-topbar">
			<div class="selection-summary">
				<strong>{selected?.designator ?? 'Projet'}</strong>
				<span>
					{selected
						? selected.bom?.comment ||
							selected.schematic?.comment ||
							selected.pcb?.comment ||
							selected.category
						: 'Visionneuse locale'}
				</span>
			</div>
			<nav aria-label="Viewer tabs">
				<button
					class:active={viewerTab === 'schematic'}
					disabled={!availableViewerTabs.schematic}
					onclick={() => openTab('schematic')}>SCH</button
				>
				<button
					class:active={viewerTab === 'pcb'}
					disabled={!availableViewerTabs.pcb}
					onclick={() => openTab('pcb')}>PCB</button
				>
				<button
					class:active={viewerTab === 'gerber'}
					disabled={!availableViewerTabs.gerber}
					onclick={() => openTab('gerber')}>FAB</button
				>
				<button
					class:active={viewerTab === '3d'}
					disabled={!availableViewerTabs['3d']}
					onclick={() => openTab('3d')}>3D</button
				>
				<button
					class:active={viewerTab === 'bom'}
					disabled={!availableViewerTabs.bom}
					onclick={() => openTab('bom')}>BOM</button
				>
			</nav>
			<button class="compare-button" onclick={onCompare}>Comparaison</button>
		</header>

		<div class="viewer-stage">
			{#if viewerTab === 'pcb' && availableViewerTabs.pcb}
				<PcbDiffCanvas />
			{:else if viewerTab === 'schematic' && availableViewerTabs.schematic}
				<SchematicDiffCanvas />
			{:else if viewerTab === 'gerber' && availableViewerTabs.gerber}
				<GerberViewer files={projectStore.gerberA} odbPackages={projectStore.odbA} />
			{:else if viewerTab === 'bom' && availableViewerTabs.bom}
				<BomDiffTable />
			{:else}
				<div class="empty-view">
					<strong>{viewerTab.toUpperCase()}</strong>
					<span>Cette vue sera branchee dans la prochaine etape.</span>
				</div>
			{/if}
		</div>
	</section>
</section>

<style>
	.project-viewer {
		display: grid;
		grid-template-columns: 250px minmax(0, 1fr);
		width: 100%;
		height: 100%;
		min-height: 0;
		background: #f4f6f8;
	}

	.bom-rail {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-right: 1px solid #d7dce3;
		background: #202326;
		color: #e5e7eb;
	}

	.bom-rail header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 14px 14px 10px;
	}

	.bom-rail header div,
	.selection-summary {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.bom-rail strong,
	.selection-summary strong {
		font-size: 0.88rem;
	}

	.bom-rail span,
	.selection-summary span {
		color: #9ca3af;
		font-size: 0.72rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.advanced-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		color: #cbd5e1;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.bom-search {
		margin: 0 12px 10px;
		min-height: 30px;
		border: 1px solid #374151;
		border-radius: 5px;
		background: #111827;
		color: #f8fafc;
		padding: 0 8px;
	}

	.bom-list {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 4px 8px 12px;
	}

	.bom-list button {
		display: grid;
		grid-template-columns: 58px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 34px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: #e5e7eb;
		padding: 5px 7px;
		text-align: left;
	}

	.bom-list button:hover,
	.bom-list button.selected {
		background: #2563eb;
		color: #ffffff;
	}

	.bom-list button span {
		color: #aeb7c2;
	}

	.bom-list button.selected span,
	.bom-list button:hover span {
		color: #dbeafe;
	}

	.bom-list p {
		margin: 16px 8px;
		color: #94a3b8;
		font-size: 0.82rem;
	}

	.viewer-area {
		display: grid;
		grid-template-rows: 52px minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
	}

	.viewer-topbar {
		display: grid;
		grid-template-columns: minmax(160px, 1fr) auto auto;
		align-items: center;
		gap: 14px;
		border-bottom: 1px solid #d7dce3;
		background: #2a2d30;
		color: #ffffff;
		padding: 0 14px;
	}

	.viewer-topbar nav {
		display: flex;
		align-self: stretch;
	}

	.viewer-topbar nav button {
		min-width: 64px;
		border: 0;
		border-bottom: 3px solid transparent;
		background: transparent;
		color: #d1d5db;
		font-size: 0.78rem;
		font-weight: 900;
		padding: 0 12px;
	}

	.viewer-topbar nav button.active {
		border-bottom-color: #f97316;
		background: #3b3f43;
		color: #ffffff;
	}

	.viewer-topbar nav button:disabled {
		cursor: default;
		opacity: 0.38;
	}

	.compare-button {
		border: 1px solid #4b5563;
		border-radius: 5px;
		background: #111827;
		color: #ffffff;
		font-size: 0.76rem;
		font-weight: 900;
		min-height: 32px;
		padding: 0 12px;
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
