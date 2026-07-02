<script lang="ts">
	import { onMount } from 'svelte';
	import BomDiffTable from '$lib/components/BomDiffTable.svelte';
	import PcbDiffCanvas from '$lib/components/PcbDiffCanvas.svelte';
	import ProjectDropZone from '$lib/components/ProjectDropZone.svelte';
	import SchematicDiffCanvas from '$lib/components/SchematicDiffCanvas.svelte';
	import {
		getBomDiff,
		getArcDiff,
		getPadDiff,
		getPcbComponentDiff,
		getPolygonDiff,
		getSchematicComponentDiff,
		getTrackDiff,
		getViaDiff,
		type DiffStatus
	} from '$lib/diff/altiumDiff';
	import { searchProject, type ComponentCategory } from '$lib/domain/project';
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
	let reviewedChanges = $state<Set<string>>(new Set());
	let reviewNotes = $state<Record<string, string>>({});
	let loadedReviewKey = $state('');
	let commandOpen = $state(false);
	let commandQuery = $state('');
	let commandInput = $state<HTMLInputElement | null>(null);

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
		for (const diff of getPcbComponentDiff(projectStore.projectA.pcb, projectStore.projectB.pcb)) {
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
		for (const diff of getTrackDiff(projectStore.projectA.pcb, projectStore.projectB.pcb))
			addRouting(diff.item.net, diff.status, 'tracks');
		for (const diff of getArcDiff(projectStore.projectA.pcb, projectStore.projectB.pcb))
			addRouting(diff.item.net, diff.status, 'arcs');
		for (const diff of getViaDiff(projectStore.projectA.pcb, projectStore.projectB.pcb))
			addRouting(diff.item.net, diff.status, 'vias');
		for (const diff of getPadDiff(projectStore.projectA.pcb, projectStore.projectB.pcb))
			addRouting(diff.item.net, diff.status, 'pads');
		for (const diff of getPolygonDiff(projectStore.projectA.pcb, projectStore.projectB.pcb))
			addRouting(diff.item.net, diff.status, 'planes');
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
		reviewChanges.filter((change) =>
			reviewFilter === 'all'
				? true
				: reviewFilter === 'pending'
					? !reviewedChanges.has(change.key)
					: change.status === reviewFilter
		)
	);
	const reviewedCount = $derived(
		reviewChanges.filter((change) => reviewedChanges.has(change.key)).length
	);
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
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
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
			};
			reviewedChanges = new Set(
				(saved.reviewed ?? []).map((key) =>
					key.includes(':') ? key : `COMPONENT:${key.toUpperCase()}`
				)
			);
			reviewNotes = saved.notes ?? {};
		} catch {
			reviewedChanges = new Set();
			reviewNotes = {};
		}
		loadedReviewKey = key;
	});

	$effect(() => {
		if (!loadedReviewKey || loadedReviewKey !== reviewStorageKey) return;
		window.localStorage.setItem(
			loadedReviewKey,
			JSON.stringify({ reviewed: Array.from(reviewedChanges), notes: reviewNotes })
		);
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

	function toggleReviewed(key: string) {
		const next = new Set(reviewedChanges);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		reviewedChanges = next;
	}

	function updateReviewNote(key: string, note: string) {
		reviewNotes = { ...reviewNotes, [key]: note };
	}

	function escapeHtml(value: string) {
		return value
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;');
	}

	function exportReviewReport() {
		const rows = reviewChanges
			.map((change) => {
				const key = change.key;
				const reviewed = reviewedChanges.has(key);
				return `<tr class="${change.status}"><td>${change.kind === 'net' ? 'Net' : 'Component'}</td><td>${escapeHtml(change.value)}</td><td>${change.status}</td><td>${escapeHtml(change.sources.map((source) => (source === 'schematic' ? 'SCH' : source.toUpperCase())).join(', '))}</td><td>${escapeHtml(change.summary)}</td><td>${reviewed ? 'Reviewed' : 'Pending'}</td><td>${escapeHtml(reviewNotes[key] ?? '')}</td></tr>`;
			})
			.join('');
		const title = `Altium review · ${projectStore.filesA[0]?.name ?? 'A'} → ${projectStore.filesB[0]?.name ?? 'B'}`;
		const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:14px Inter,Arial,sans-serif;color:#172033;margin:32px}h1{margin:0 0 6px}p{color:#64748b}.summary{display:flex;gap:12px;margin:24px 0}.summary b{padding:9px 12px;border-radius:8px;background:#f1f5f9}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f8fafc}.added td:first-child{border-left:4px solid #16a34a}.modified td:first-child{border-left:4px solid #f97316}.removed td:first-child{border-left:4px solid #dc2626}@media print{body{margin:14mm}}</style></head><body><h1>${escapeHtml(title)}</h1><p>Generated ${escapeHtml(new Date().toLocaleString())}</p><div class="summary"><b>${reviewChanges.length} changes</b><b>${reviewedCount} reviewed</b><b>${reviewChanges.length - reviewedCount} pending</b></div><table><thead><tr><th>Kind</th><th>Item</th><th>Status</th><th>Views</th><th>Description</th><th>Review</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
		const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `altium-review-${new Date().toISOString().slice(0, 10)}.html`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
</script>

<svelte:head>
	<title>Altium Diff Studio</title>
</svelte:head>

<main class:workspace={isReady} class:minimal={projectStore.minimalUi}>
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
							<button
								class="export-review"
								disabled={reviewChanges.length === 0}
								onclick={exportReviewReport}
							>
								Export report
							</button>
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
					<button
						onclick={() => {
							projectStore.minimalUi = !projectStore.minimalUi;
							closeCommands();
						}}
					>
						<span>{projectStore.minimalUi ? 'Show advanced tools' : 'Return to minimal mode'}</span>
						<small>Appearance</small>
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
