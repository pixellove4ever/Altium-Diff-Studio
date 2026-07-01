<script lang="ts">
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import ProjectDropZone from '$lib/components/ProjectDropZone.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import { searchProject, type ComponentCategory } from '$lib/domain/project';
	import { projectStore, type WorkspaceTab } from '$lib/state/projectStore.svelte';

	const tabs: Array<{ id: WorkspaceTab; label: string }> = [
		{ id: 'pcb', label: 'PCB Diff' },
		{ id: 'schematic', label: 'Schematic Diff' },
		{ id: 'bom', label: 'BOM Diff' }
	];

	const isReady = $derived(projectStore.isReady);
	const activeIndex = $derived(projectStore.mode === 'compare' ? projectStore.indexB : projectStore.indexA);
	const searchResults = $derived(
		searchProject(activeIndex, projectStore.searchQuery, projectStore.componentCategory).slice(0, 80)
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

	function chooseMode(mode: 'compare' | 'view') {
		projectStore.setMode(mode);
		modeChosen = true;
	}

	function returnHome() {
		projectStore.reset();
		modeChosen = false;
		sidebarCollapsed = false;
	}
</script>

<svelte:head>
	<title>Altium Diff Studio</title>
</svelte:head>

<main class:workspace={isReady}>
	<header class="topbar">
		<div>
			<h1>Altium Diff Studio</h1>
			<p>
				{projectStore.mode === 'view'
					? 'Local viewer for PCB, schematic, and BOM exports.'
					: 'Local hardware review workspace for BOM, PCB, and schematic deltas.'}
			</p>
		</div>
		{#if modeChosen}
			<div class="topbar-actions">
				{#if isReady}
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
			<ProjectDropZone side="A" title={projectStore.mode === 'view' ? 'Project export' : 'Baseline export'} />
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

				<div class="probe">
					<label for="designator">Project search</label>
					<input
						id="designator"
						placeholder="Designator, value, net, MPN…"
						bind:value={projectStore.searchQuery}
					/>
					<select bind:value={projectStore.componentCategory}>
						{#each categories as category}
							<option value={category.id}>{category.label}</option>
						{/each}
					</select>
					<div class="search-results">
						{#each searchResults as component}
							<button
								class:selected={projectStore.selectedDesignator === component.designator}
								onclick={() => projectStore.selectDesignator(component.designator)}
							>
								<strong>{component.designator}</strong>
								<span>{component.bom?.comment || component.schematic?.comment || component.pcb?.comment || component.category}</span>
							</button>
						{/each}
					</div>
				</div>

				{#if selected}
					<section class="component-card">
						<div class="card-title">
							<strong>{selected.designator}</strong>
							<span>{selected.category}</span>
						</div>
						<p>{selected.bom?.comment || selected.schematic?.comment || selected.pcb?.comment || 'No value'}</p>
						<dl>
							{#if selected.sheet}<dt>Sheet</dt><dd>{selected.sheet.name}</dd>{/if}
							{#if selected.pcb}<dt>PCB</dt><dd>{selected.pcb.layer} · {selected.pcb.x.toFixed(2)}, {selected.pcb.y.toFixed(2)}</dd>{/if}
							{#if selected.bom?.footprint || selected.pcb?.footprint}<dt>Footprint</dt><dd>{selected.bom?.footprint || selected.pcb?.footprint}</dd>{/if}
							{#if selected.bom?.parameters?.Manufacturer}<dt>Manufacturer</dt><dd>{selected.bom.parameters.Manufacturer}</dd>{/if}
							{#if selected.bom?.parameters?.PartNumber}<dt>Part number</dt><dd>{selected.bom.parameters.PartNumber}</dd>{/if}
							{#if selected.nets.length}<dt>Nets</dt><dd>{selected.nets.join(', ')}</dd>{/if}
						</dl>
						<div class="presence">
							<span class:present={selected.bom}>BOM</span>
							<span class:present={selected.schematic}>SCH</span>
							<span class:present={selected.pcb}>PCB</span>
						</div>
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
