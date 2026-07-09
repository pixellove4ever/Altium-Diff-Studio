<script lang="ts">
	import ViewerHost from '$lib/components/ViewerHost.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';

	let query = $state('');
	let showHiddenBomRefs = $state(false);

	const visibleComponents = $derived(
		showHiddenBomRefs && !viewerStore.minimalUi
			? projectStore.indexA.components
			: projectStore.indexA.components.filter((component) => component.visibleInBomViewer)
	);
	const hiddenBomRefCount = $derived(
		projectStore.indexA.components.filter((component) => !component.visibleInBomViewer).length
	);

	const filteredComponents = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return visibleComponents;
		return visibleComponents.filter((component) => component.searchText.includes(needle));
	});

	function selectComponent(designator: string) {
		projectStore.selectDesignator(designator);
	}

	function toggleAdvanced(event: Event) {
		viewerStore.minimalUi = !(event.currentTarget as HTMLInputElement).checked;
	}
</script>

<section class="project-shell">
	<aside class="bom-rail" aria-label={localeStore.t('shell.bomRailAria')}>
		<header>
			<div>
				<strong>{localeStore.t('shell.bomLabel')}</strong>
				<span>{localeStore.t('shell.refsCount', { count: visibleComponents.length })}</span>
			</div>
			<label class="advanced-toggle">
				<input type="checkbox" checked={!viewerStore.minimalUi} onchange={toggleAdvanced} />
				<span>{localeStore.t('shell.advancedLabel')}</span>
			</label>
		</header>
		{#if !viewerStore.minimalUi && hiddenBomRefCount > 0}
			<label class="hidden-toggle">
				<input type="checkbox" bind:checked={showHiddenBomRefs} />
				<span>{localeStore.t('shell.showHiddenBOM', { count: hiddenBomRefCount })}</span>
			</label>
		{/if}
		<input
			class="bom-search"
			bind:value={query}
			placeholder={localeStore.t('shell.searchPlaceholder')}
		/>
		<div class="bom-list">
			{#each filteredComponents as component}
				<button
					class:selected={projectStore.selectedDesignator === component.designator}
					onclick={() => selectComponent(component.designator)}
				>
					<strong>{component.designator}</strong>
					<span>
						{component.bom?.comment || component.schematic?.comment || component.pcb?.comment || ''}
						{#if component.bomViewerHiddenReason}
							<em>{component.bomViewerHiddenReason}</em>
						{/if}
					</span>
				</button>
			{/each}
			{#if filteredComponents.length === 0}
				<p>{localeStore.t('shell.noComponent')}</p>
			{/if}
		</div>
	</aside>

	<ViewerHost />
</section>

<style>
	.project-shell {
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

	.bom-rail header div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.bom-rail strong {
		font-size: 0.88rem;
	}

	.bom-rail span {
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

	.hidden-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 12px 8px;
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

	.bom-list button em {
		display: inline-block;
		margin-left: 5px;
		border-radius: 3px;
		background: rgba(148, 163, 184, 0.22);
		color: #cbd5e1;
		font-size: 0.62rem;
		font-style: normal;
		font-weight: 800;
		padding: 1px 4px;
		text-transform: uppercase;
	}

	.bom-list button.selected span,
	.bom-list button:hover span {
		color: #dbeafe;
	}

	.bom-list button.selected em,
	.bom-list button:hover em {
		background: rgba(219, 234, 254, 0.24);
		color: #ffffff;
	}

	.bom-list p {
		margin: 16px 8px;
		color: #94a3b8;
		font-size: 0.82rem;
	}
</style>
