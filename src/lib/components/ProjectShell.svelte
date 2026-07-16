<script lang="ts">
	import ViewerHost from '$lib/components/ViewerHost.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';
	import { busSelectionValue, netBusName } from '$lib/domain/netSelection';

	let query = $state('');
	let showHiddenBomRefs = $state(false);
	let railWidth = $state(250);
	let railCollapsed = $state(false);
	let shellElement = $state<HTMLElement | null>(null);
	let busesExpanded = $state(true);
	let tracksExpanded = $state(true);
	let resizingRail = false;

	const visibleComponents = $derived(
		showHiddenBomRefs && !viewerStore.minimalUi
			? projectStore.indexA.components.filter((component) => component.designator.trim())
			: projectStore.indexA.components.filter(
					(component) =>
						component.designator.trim() &&
						component.visibleInBomViewer &&
						componentSummary(component)
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
	const signalBusGroups = $derived.by(() => {
		const groups = new Map<string, string[]>();
		for (const net of signalRailIndex.nets) {
			const bus = netBusName(net);
			if (!bus) continue;
			const entries = groups.get(bus) ?? [];
			entries.push(net);
			groups.set(bus, entries);
		}
		return Array.from(groups.entries())
			.filter(([, nets]) => nets.length > 1)
			.map(([name, nets]) => ({ name, nets }))
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	});

	const filteredComponents = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return visibleComponents;
		return visibleComponents.filter((component) => component.searchText.includes(needle));
	});
	const filteredSignals = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		const nets = !needle
			? signalRailIndex.nets
			: signalRailIndex.nets.filter((net) => {
					const details = signalRailIndex.byNet.get(net.toUpperCase());
					return (
						net.toLowerCase().includes(needle) ||
						details?.components.some((designator) => designator.toLowerCase().includes(needle))
					);
				});
		const buses = signalBusGroups.filter((bus) => {
			if (!needle) return true;
			return (
				bus.name.toLowerCase().includes(needle) ||
				bus.nets.some((net) => {
					if (net.toLowerCase().includes(needle)) return true;
					const details = signalRailIndex.byNet.get(net.toUpperCase());
					return details?.components.some((designator) =>
						designator.toLowerCase().includes(needle)
					);
				})
			);
		});
		return [
			...buses.map((bus) => ({
				kind: 'bus' as const,
				label: bus.name,
				value: busSelectionValue(bus.name),
				nets: bus.nets
			})),
			...nets.map((net) => ({ kind: 'net' as const, label: net, value: net, nets: [net] }))
		];
	});
	const filteredBusSignals = $derived(filteredSignals.filter((item) => item.kind === 'bus'));
	const filteredTrackSignals = $derived(filteredSignals.filter((item) => item.kind === 'net'));

	function signalActivity(nets: string[], kind: 'bus' | 'net') {
		const totals = nets.reduce(
			(total, net) => {
				const details = signalRailIndex.byNet.get(net.toUpperCase());
				if (!details) return total;
				total.objects +=
					details.tracks.length +
					details.vias.length +
					details.pads.length +
					details.polygons.length;
				for (const component of details.components) total.components.add(component);
				return total;
			},
			{ objects: 0, components: new Set<string>() }
		);
		if (kind === 'bus') return `${nets.length} nets`;
		if (viewerStore.minimalUi) return `${totals.objects} objects`;
		return `${totals.objects} objects - ${totals.components.size} comps`;
	}

	function onRailResizeDown(event: PointerEvent) {
		resizingRail = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onRailResizeMove(event: PointerEvent) {
		if (!resizingRail) return;
		const left = shellElement?.getBoundingClientRect().left ?? 0;
		railWidth = Math.max(190, Math.min(420, event.clientX - left));
	}

	function onRailResizeUp(event: PointerEvent) {
		resizingRail = false;
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	}

	function selectSignal(value: string) {
		projectStore.selectNet(value);
	}

	function selectComponent(component: (typeof projectStore.indexA.components)[number]) {
		projectStore.selectDesignator(component.designator);
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

	function railLabel() {
		return hasSignalRail ? 'Signals' : localeStore.t('shell.bomLabel');
	}
</script>

<section
	class="project-shell"
	class:no-bom-rail={!hasBomRail && !hasSignalRail}
	class:rail-collapsed={railCollapsed && (hasBomRail || hasSignalRail)}
	style={`--rail-width: ${railWidth}px`}
	bind:this={shellElement}
>
	{#if railCollapsed && (hasBomRail || hasSignalRail)}
		<button
			class="rail-reopen"
			type="button"
			aria-label={`Show ${railLabel()} panel`}
			title={`Show ${railLabel()} panel`}
			onclick={() => (railCollapsed = false)}
		>
			<span>{railLabel()}</span>
		</button>
	{:else if hasBomRail}
		<aside class="bom-rail" aria-label={localeStore.t('shell.bomRailAria')}>
			<header>
				<div>
					<strong>{localeStore.t('shell.bomLabel')}</strong>
					<span>{localeStore.t('shell.refsCount', { count: visibleComponents.length })}</span>
				</div>
				<button
					class="rail-collapse"
					type="button"
					aria-label={`Hide ${localeStore.t('shell.bomLabel')} panel`}
					title={`Hide ${localeStore.t('shell.bomLabel')} panel`}
					onclick={() => (railCollapsed = true)}
				></button>
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
					<span>{signalRailIndex.nets.length} nets - {signalBusGroups.length} buses</span>
				</div>
				<button
					class="rail-collapse"
					type="button"
					aria-label="Hide Signals panel"
					title="Hide Signals panel"
					onclick={() => (railCollapsed = true)}
				></button>
			</header>
			<input class="bom-search" bind:value={query} placeholder="Signal, net, component..." />
			<div class="bom-list signal-list">
				<section class="signal-section" class:collapsed={!busesExpanded}>
					<button
						class="signal-section-toggle"
						type="button"
						aria-expanded={busesExpanded}
						onclick={() => (busesExpanded = !busesExpanded)}
					>
						<strong>Bus</strong>
						<span>{filteredBusSignals.length}</span>
					</button>
					{#if busesExpanded}
						{#each filteredBusSignals as item}
							<button
								class="bus-signal"
								class:selected={projectStore.selectedNet?.toUpperCase() ===
									item.value.toUpperCase()}
								onclick={() => selectSignal(item.value)}
							>
								<strong>{item.label} bus</strong>
								<span>{signalActivity(item.nets, item.kind)}</span>
							</button>
						{/each}
					{/if}
				</section>
				<section class="signal-section" class:collapsed={!tracksExpanded}>
					<button
						class="signal-section-toggle"
						type="button"
						aria-expanded={tracksExpanded}
						onclick={() => (tracksExpanded = !tracksExpanded)}
					>
						<strong>Pistes</strong>
						<span>{filteredTrackSignals.length}</span>
					</button>
					{#if tracksExpanded}
						{#each filteredTrackSignals as item}
							<button
								class:selected={projectStore.selectedNet?.toUpperCase() ===
									item.value.toUpperCase()}
								onclick={() => selectSignal(item.value)}
							>
								<strong>{item.label}</strong>
								<span>{signalActivity(item.nets, item.kind)}</span>
							</button>
						{/each}
					{/if}
				</section>
				{#if filteredSignals.length === 0}
					<p>No signal.</p>
				{/if}
			</div>
		</aside>
	{/if}
	{#if (hasBomRail || hasSignalRail) && !railCollapsed}
		<button
			class="rail-resizer"
			type="button"
			aria-label="Resize side panel"
			onpointerdown={onRailResizeDown}
			onpointermove={onRailResizeMove}
			onpointerup={onRailResizeUp}
			onpointercancel={onRailResizeUp}
		></button>
	{/if}

	<ViewerHost />
</section>

<style>
	.project-shell {
		display: grid;
		grid-template-columns: var(--rail-width, 250px) 6px minmax(0, 1fr);
		width: 100%;
		height: 100%;
		min-height: 0;
		background: #f4f6f8;
	}

	.project-shell.no-bom-rail {
		grid-template-columns: minmax(0, 1fr);
	}

	.project-shell.rail-collapsed {
		grid-template-columns: 28px minmax(0, 1fr);
	}

	.rail-reopen {
		display: grid;
		place-items: center;
		width: 28px;
		height: 100%;
		border: 0;
		border-right: 1px solid #d7dce3;
		background: #202326;
		color: #cbd5e1;
		cursor: pointer;
		padding: 0;
	}

	.rail-reopen:hover {
		background: #111827;
		color: #ffffff;
	}

	.rail-reopen span {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		color: inherit;
		font-size: 0.68rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.rail-resizer {
		width: 6px;
		height: 100%;
		border: 0;
		background: #111827;
		cursor: col-resize;
		opacity: 0.24;
		padding: 0;
	}

	.rail-resizer:hover,
	.rail-resizer:active {
		opacity: 0.5;
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

	.rail-collapse {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 1px solid rgba(148, 163, 184, 0.32);
		border-radius: 5px;
		background: rgba(15, 23, 42, 0.45);
		color: #cbd5e1;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}

	.rail-collapse::before {
		content: '';
		width: 7px;
		height: 7px;
		border-left: 2px solid currentColor;
		border-bottom: 2px solid currentColor;
		transform: rotate(45deg) translate(1px, -1px);
	}

	.rail-collapse:hover {
		border-color: rgba(219, 234, 254, 0.7);
		background: rgba(37, 99, 235, 0.22);
		color: #ffffff;
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

	.signal-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 8px;
	}

	.signal-section-toggle {
		position: sticky;
		top: 0;
		z-index: 1;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 8px;
		min-height: 24px;
		border-bottom: 1px solid rgba(148, 163, 184, 0.18);
		background: #202326;
		color: #cbd5e1;
		margin-top: 2px;
		padding: 3px 6px;
		text-transform: uppercase;
	}

	.signal-section-toggle:hover {
		background: rgba(148, 163, 184, 0.12);
		color: #f8fafc;
	}

	.signal-section-toggle::before {
		content: '';
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border: 1px solid rgba(148, 163, 184, 0.5);
		border-radius: 4px;
		background:
			linear-gradient(45deg, transparent 45%, #cbd5e1 45% 55%, transparent 55%) center / 7px 7px
				no-repeat,
			rgba(15, 23, 42, 0.55);
		color: #94a3b8;
		transform: rotate(90deg);
	}

	.signal-section.collapsed .signal-section-toggle::before {
		transform: rotate(0deg);
	}

	.signal-section-toggle span {
		justify-self: end;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.16);
		color: #cbd5e1;
		padding: 1px 6px;
	}

	.signal-section-toggle:hover {
		color: #f8fafc;
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

	.signal-list button.bus-signal {
		border-bottom: 1px solid rgba(148, 163, 184, 0.16);
		background: rgba(14, 165, 233, 0.1);
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
