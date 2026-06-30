<script lang="ts">
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import ProjectDropZone from '$lib/components/ProjectDropZone.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import { projectStore, type WorkspaceTab } from '$lib/state/projectStore.svelte';

	const tabs: Array<{ id: WorkspaceTab; label: string }> = [
		{ id: 'pcb', label: 'PCB Diff' },
		{ id: 'schematic', label: 'Schematic Diff' },
		{ id: 'bom', label: 'BOM Diff' }
	];

	const isReady = $derived(projectStore.isReady);
</script>

<svelte:head>
	<title>Altium Diff Studio</title>
</svelte:head>

<main class:workspace={isReady}>
	<header class="topbar">
		<div>
			<h1>Altium Diff Studio</h1>
			<p>Local hardware review workspace for BOM, PCB, and schematic deltas.</p>
		</div>
		{#if isReady}
			<button onclick={() => projectStore.reset()}>Reset</button>
		{/if}
	</header>

	{#if projectStore.error}
		<section class="error">{projectStore.error}</section>
	{/if}
	{#if projectStore.warning}
		<section class="warning">{projectStore.warning}</section>
	{/if}

	{#if !isReady}
		<section class="landing">
			<ProjectDropZone side="A" title="Baseline export" />
			<ProjectDropZone side="B" title="Candidate export" />
		</section>
	{:else}
		<section class="workspace-grid">
			<aside>
				<nav>
					{#each tabs as tab}
						<button
							class:active={projectStore.activeTab === tab.id}
							disabled={!projectStore.availableTabs.includes(tab.id)}
							onclick={() => (projectStore.activeTab = tab.id)}
						>
							{tab.label}
						</button>
					{/each}
				</nav>

				<div class="probe">
					<label for="designator">Cross-probe designator</label>
					<input
						id="designator"
						placeholder="R1, U4, C17"
						value={projectStore.selectedDesignator ?? ''}
						oninput={(event) =>
							projectStore.selectDesignator((event.currentTarget as HTMLInputElement).value || null)}
					/>
				</div>
			</aside>

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
