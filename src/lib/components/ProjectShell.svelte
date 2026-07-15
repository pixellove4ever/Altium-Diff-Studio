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
			: projectStore.indexA.components.filter(
					(component) => component.visibleInBomViewer && componentSummary(component)
				)
	);
	const hiddenBomRefCount = $derived(
		projectStore.indexA.components.filter((component) => !component.visibleInBomViewer).length
	);
	const hasBomRail = $derived(
		viewerStore.projectViewerTab !== 'bom' &&
			viewerStore.projectViewerTab !== 'gerber' &&
			!(
				viewerStore.projectViewerTab === 'schematic' && viewerStore.schematicRenderMode === 'pdf'
			) &&
			!(viewerStore.projectViewerTab === 'pcb' && viewerStore.pcbSelectionMode === 'track') &&
			(!!projectStore.projectA.bom || !!projectStore.projectB.bom)
	);
	const hasSignalRail = $derived(
		viewerStore.projectViewerTab === 'pcb' && viewerStore.pcbSelectionMode === 'track'
	);
	const signalRailIndex = $derived(
		projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB
	);

	const filteredComponents = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return visibleComponents;
		return visibleComponents.filter((component) => component.searchText.includes(needle));
	});
	const filteredSignals = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return signalRailIndex.nets;
		return signalRailIndex.nets.filter((net) => {
			const details = signalRailIndex.byNet.get(net.toUpperCase());
			return (
				net.toLowerCase().includes(needle) ||
				details?.components.some((designator) => designator.toLowerCase().includes(needle))
			);
		});
	});

	function selectComponent(component: (typeof projectStore.indexA.components)[number]) {
		projectStore.selectDesignator(component.designator);
	}

	function netActivity(net: string) {
		const details = signalRailIndex.byNet.get(net.toUpperCase());
		if (!details) return '';
		const count =
			details.tracks.length + details.vias.length + details.pads.length + details.polygons.length;
		const comps = details.components.length;
		if (viewerStore.minimalUi) return `${count} objects`;
		return `${count} objects - ${comps} comps`;
	}

	function selectNet(net: string) {
		projectStore.selectNet(net);
	}

	function usefulLabel(value: string | undefined) {
		const normalized = value?.trim();
		if (!normalized) return '';
		const lower = normalized.toLowerCase().replace(/\s+/g, '');
		if (['=value', 'value', '=comment', 'comment'].includes(lower)) return '';
		return normalized;
	}

	function componentSummary(component: (typeof projectStore.indexA.components)[number]) {
		const simpleSummary =
			usefulLabel(component.bom?.comment) ||
			usefulLabel(component.schematic?.value) ||
			usefulLabel(component.schematic?.comment);
		if (viewerStore.minimalUi) return simpleSummary || usefulLabel(component.pcb?.comment);
		return (
			simpleSummary ||
			usefulLabel(component.bom?.description) ||
			usefulLabel(component.pcb?.comment) ||
			usefulLabel(component.pcb?.footprint) ||
			usefulLabel(component.schematic?.libRef)
		);
	}

	function toggleAdvanced(event: Event) {
		viewerStore.minimalUi = !(event.currentTarget as HTMLInputElement).checked;
	}
</script>

<section class="project-shell" class:no-bom-rail={!hasBomRail && !hasSignalRail}>
	{#if hasBomRail}
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
						class:selected={projectStore.selectedDesignator?.toUpperCase() ===
							component.designator.toUpperCase()}
						onclick={() => selectComponent(component)}
					>
						<strong>{component.designator}</strong>
						<span>
							{componentSummary(component)}
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
	{:else if hasSignalRail}
		<aside class="bom-rail signal-rail" aria-label="PCB signals">
			<header>
				<div>
					<strong>Signals</strong>
					<span>{signalRailIndex.nets.length} nets</span>
				</div>
				<label class="advanced-toggle">
					<input type="checkbox" checked={!viewerStore.minimalUi} onchange={toggleAdvanced} />
					<span>{localeStore.t('shell.advancedLabel')}</span>
				</label>
			</header>
			<input class="bom-search" bind:value={query} placeholder="Signal, net, component..." />
			<div class="bom-list signal-list">
				{#each filteredSignals as net}
					<button
						class:selected={projectStore.selectedNet?.toUpperCase() === net.toUpperCase()}
						onclick={() => selectNet(net)}
					>
						<strong>{net}</strong>
						<span>{netActivity(net)}</span>
					</button>
				{/each}
				{#if filteredSignals.length === 0}
					<p>No signal.</p>
				{/if}
			</div>
		</aside>
	{/if}

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

	.project-shell.no-bom-rail {
		grid-template-columns: minmax(0, 1fr);
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
		flex-shrink: 0;
		color: #cbd5e1;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.advanced-toggle input {
		margin: 0;
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

	.signal-list button {
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
	}

	.signal-list button strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.signal-list button span {
		justify-self: end;
		max-width: 86px;
		text-align: right;
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
