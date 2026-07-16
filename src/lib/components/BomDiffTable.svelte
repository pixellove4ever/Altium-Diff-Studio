<script lang="ts">
	import { diffColors, getBomDiff, type BomDiffRow } from '$lib/diff/altiumDiff';
	import { createBomDiffCsv } from '$lib/domain/bomDiffExport';
	import { bomViewerHiddenReason, shouldShowBomItemInViewer } from '$lib/domain/bomVisibility';
	import type { ProjectComponent } from '$lib/domain/project';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';

	function componentBomRow(component: ProjectComponent): BomDiffRow {
		return {
			designator: component.designator,
			status: 'unchanged',
			before: component.bom ?? null,
			after: component.bom ?? null,
			changes: []
		};
	}

	const rows = $derived.by(() =>
		(projectStore.mode === 'view'
			? projectStore.indexA.components.map(componentBomRow)
			: getBomDiff(projectStore.projectA.bom, projectStore.projectB.bom)
		).filter((row) => row.designator.trim())
	);
	let query = $state('');
	let exportScope = $state<'complete' | 'filtered'>('complete');
	let showHiddenBomRefs = $state(false);
	type BomSortKey = 'status' | 'designator' | 'before' | 'after' | 'changes';
	let sortKey = $state<BomSortKey>('designator');
	let sortDirection = $state<'asc' | 'desc'>('asc');
	let statusFilter = $state<'all' | BomDiffRow['status']>('all');
	let changedFieldFilter = $state('');
	const viewerRows = $derived.by(() =>
		projectStore.mode === 'view'
			? rows.filter((row) => {
					const component = projectStore.indexA.byDesignator.get(row.designator.toUpperCase());
					return (
						component?.visibleInBomViewer ?? shouldShowBomItemInViewer(row.before ?? undefined)
					);
				})
			: rows.filter((row) => shouldShowBomItemInViewer(row.after ?? row.before ?? undefined))
	);
	const hiddenViewerRowCount = $derived(rows.length - viewerRows.length);
	const showAdvancedBomColumns = $derived(projectStore.mode !== 'view' || !viewerStore.minimalUi);
	const emptyColspan = $derived(
		projectStore.mode === 'compare' ? 4 : showAdvancedBomColumns ? 5 : 2
	);
	const visibleRows = $derived.by(() => {
		const candidates =
			projectStore.mode === 'view'
				? showHiddenBomRefs && !viewerStore.minimalUi
					? rows
					: viewerRows
				: rows.filter(
						(row) =>
							row.status !== 'unchanged' &&
							(statusFilter === 'all' || row.status === statusFilter) &&
							(!changedFieldFilter ||
								row.changes.some((change) => change.field === changedFieldFilter))
					);
		const needle = query.trim().toLowerCase();
		const filtered = !needle
			? candidates
			: candidates.filter((row) => {
					const item = row.after ?? row.before;
					return [
						row.designator,
						row.status,
						itemText(row, 'before'),
						itemText(row, 'after'),
						summarize(row),
						item?.comment,
						item?.footprint,
						item?.libRef,
						item?.description,
						...Object.entries(item?.parameters ?? {}).flat()
					].some((entry) =>
						String(entry ?? '')
							.toLowerCase()
							.includes(needle)
					);
				});
		return [...filtered].sort(compareRows);
	});
	const changedFieldOptions = $derived(
		Array.from(new Set(rows.flatMap((row) => row.changes.map((change) => change.field)))).sort()
	);

	function compareRows(left: BomDiffRow, right: BomDiffRow) {
		const statusOrder: Record<BomDiffRow['status'], number> = {
			added: 0,
			removed: 1,
			modified: 2,
			unchanged: 3
		};
		const value = (row: BomDiffRow) => {
			if (sortKey === 'status') return statusOrder[row.status];
			if (sortKey === 'designator') return row.designator;
			if (sortKey === 'before') return itemText(row, 'before');
			if (sortKey === 'after') return itemText(row, 'after');
			return summarize(row);
		};
		const leftValue = value(left);
		const rightValue = value(right);
		const direction = sortDirection === 'asc' ? 1 : -1;
		if (typeof leftValue === 'number' && typeof rightValue === 'number')
			return (leftValue - rightValue) * direction;
		return (
			String(leftValue).localeCompare(String(rightValue), undefined, {
				numeric: true,
				sensitivity: 'base'
			}) * direction
		);
	}

	function toggleSort(key: BomSortKey) {
		if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDirection = 'asc';
		}
	}

	function sortIndicator(key: BomSortKey) {
		if (sortKey !== key) return '';
		return sortDirection === 'asc' ? '▲' : '▼';
	}

	function statusLabel(status: BomDiffRow['status']) {
		if (status === 'added') return localeStore.t('bom.added');
		if (status === 'removed') return localeStore.t('bom.removed');
		if (status === 'modified') return localeStore.t('bom.modified');
		return localeStore.t('bom.unchanged');
	}

	function summarize(row: BomDiffRow) {
		if (row.status === 'added') return localeStore.t('bom.addedSummary');
		if (row.status === 'removed') return localeStore.t('bom.removedSummary');
		if (row.status === 'modified') return row.changes.map((change) => change.field).join(', ');
		return '';
	}

	function usefulText(value: string | number | boolean | undefined | null) {
		const text = String(value ?? '').trim();
		if (!text) return '';
		const compact = text.toLowerCase().replace(/\s+/g, '');
		if (['=value', 'value', '=comment', 'comment'].includes(compact)) return '';
		return text;
	}

	function parameterValue(item: BomDiffRow['before'], names: string[]) {
		for (const [key, value] of Object.entries(item?.parameters ?? {})) {
			const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '');
			if (!names.some((name) => normalizedKey === name || normalizedKey.includes(name))) continue;
			const text = usefulText(value);
			if (text) return text;
		}
		return '';
	}

	function itemValueComment(item: BomDiffRow['before']) {
		if (!item) return '-';
		return (
			usefulText(item.comment) ||
			parameterValue(item, ['value']) ||
			parameterValue(item, ['partnumber', 'mpn', 'manufacturerpartnumber']) ||
			'-'
		);
	}

	function itemDescription(item: BomDiffRow['before']) {
		if (!item) return '-';
		return (
			usefulText(item.description) ||
			usefulText(item.libRef) ||
			parameterValue(item, ['description']) ||
			'-'
		);
	}

	function itemText(row: BomDiffRow, side: 'before' | 'after') {
		const item = row[side];
		if (!item) return '-';

		return [
			itemValueComment(item),
			usefulText(item.footprint),
			usefulText(item.libRef),
			usefulText(item.description)
		]
			.filter((entry) => entry && entry !== '-')
			.join(' | ');
	}

	function parameterText(row: BomDiffRow) {
		return Object.entries((row.after ?? row.before)?.parameters ?? {})
			.map(([key, value]) => [key, usefulText(value)] as const)
			.filter(([, value]) => value)
			.map(([key, value]) => `${key}: ${value}`)
			.join(' · ');
	}

	function hiddenReason(row: BomDiffRow) {
		if (projectStore.mode === 'view') {
			const component = projectStore.indexA.byDesignator.get(row.designator.toUpperCase());
			if (component?.bomViewerHiddenReason) return component.bomViewerHiddenReason;
		}
		return bomViewerHiddenReason(row.after ?? row.before ?? undefined);
	}

	function selectReference(designator: string) {
		projectStore.selectDesignator(designator);
	}

	function exportBomDiff() {
		const sourceA = projectStore.filesA.find((file) => file.doc.type === 'bom');
		const sourceB = projectStore.filesB.find((file) => file.doc.type === 'bom');
		const exportRows =
			exportScope === 'filtered' ? visibleRows : rows.filter((row) => row.status !== 'unchanged');
		const csv = createBomDiffCsv({
			rows: exportRows,
			appVersion: __APP_VERSION__,
			locale: localeStore.locale,
			generatedAt: new Date().toISOString(),
			scope: exportScope,
			sourceA: {
				name: sourceA?.path || sourceA?.name || 'Version A',
				schemaVersion: sourceA?.doc.exportMeta?.schemaVersion
			},
			sourceB: {
				name: sourceB?.path || sourceB?.name || 'Version B',
				schemaVersion: sourceB?.doc.exportMeta?.schemaVersion
			}
		});
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `altium-bom-diff-${new Date().toISOString().slice(0, 10)}.csv`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<div class="bom-view">
	<header>
		<div>
			<h2>
				{projectStore.mode === 'view' ? localeStore.t('bom.heading') : localeStore.t('bom.title')}
			</h2>
			<p>
				{projectStore.mode === 'view'
					? `${localeStore.t('bom.designatorsCount', { count: visibleRows.length })}${hiddenViewerRowCount > 0 && !showHiddenBomRefs ? `, ${localeStore.t('bom.hiddenCount', { count: hiddenViewerRowCount })}` : ''}`
					: `${localeStore.t('bom.differencesCount', { count: visibleRows.length })}, ${localeStore.t('bom.comparedCount', { count: rows.length })}`}
			</p>
		</div>
		<input class="search" bind:value={query} placeholder={localeStore.t('bom.search')} />
		{#if projectStore.mode === 'compare'}
			<div class="bom-filters">
				<select bind:value={statusFilter} aria-label="Filter BOM status">
					<option value="all">All statuses</option>
					<option value="added">{localeStore.t('bom.added')}</option>
					<option value="removed">{localeStore.t('bom.removed')}</option>
					<option value="modified">{localeStore.t('bom.modified')}</option>
				</select>
				<select bind:value={changedFieldFilter} aria-label="Filter changed field">
					<option value="">All fields</option>
					{#each changedFieldOptions as field}
						<option value={field}>{field}</option>
					{/each}
				</select>
			</div>
		{/if}
		{#if projectStore.mode === 'view' && !viewerStore.minimalUi && hiddenViewerRowCount > 0}
			<label class="hidden-toggle">
				<input type="checkbox" bind:checked={showHiddenBomRefs} />
				<span>{localeStore.t('bom.showHiddenRefs')}</span>
			</label>
		{/if}
		{#if projectStore.mode === 'compare' && !viewerStore.minimalUi}
			<div class="export-actions">
				<select bind:value={exportScope} aria-label="BOM export scope">
					<option value="complete">{localeStore.t('bom.complete')}</option>
					<option value="filtered">{localeStore.t('bom.filtered')}</option>
				</select>
				<button
					disabled={exportScope === 'filtered'
						? visibleRows.length === 0
						: !rows.some((row) => row.status !== 'unchanged')}
					onclick={exportBomDiff}>{localeStore.t('bom.export')}</button
				>
			</div>
			<div class="legend">
				<span><i class="added"></i>{localeStore.t('bom.added')}</span>
				<span><i class="removed"></i>{localeStore.t('bom.removed')}</span>
				<span><i class="modified"></i>{localeStore.t('bom.modified')}</span>
			</div>
		{/if}
	</header>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					{#if projectStore.mode === 'compare'}
						<th>
							<button class="sort-button" onclick={() => toggleSort('status')}>
								{localeStore.t('bom.statusColumn')} <span>{sortIndicator('status')}</span>
							</button>
						</th>
					{/if}
					<th>
						<button class="sort-button" onclick={() => toggleSort('designator')}>
							{localeStore.t('bom.designatorColumn')} <span>{sortIndicator('designator')}</span>
						</button>
					</th>
					{#if projectStore.mode === 'view'}
						<th>{localeStore.t('bom.valueCommentColumn')}</th>
						{#if showAdvancedBomColumns}
							<th>{localeStore.t('bom.footprintColumn')}</th>
							<th>{localeStore.t('bom.descriptionColumn')}</th>
							<th>{localeStore.t('bom.parametersColumn')}</th>
						{/if}
					{:else}
						<th>
							<button class="sort-button" onclick={() => toggleSort('before')}>
								{localeStore.t('bom.versionAColumn')} <span>{sortIndicator('before')}</span>
							</button>
						</th>
						<th>
							<button class="sort-button" onclick={() => toggleSort('after')}>
								{localeStore.t('bom.versionBColumn')} <span>{sortIndicator('after')}</span>
							</button>
						</th>
						<th>
							<button class="sort-button" onclick={() => toggleSort('changes')}>
								{localeStore.t('bom.changedFieldsColumn')} <span>{sortIndicator('changes')}</span>
							</button>
						</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#if visibleRows.length === 0}
					<tr>
						<td colspan={emptyColspan} class="empty">{localeStore.t('bom.noData')}</td>
					</tr>
				{:else}
					{#each visibleRows as row}
						<tr
							class:selected={projectStore.selectedDesignator === row.designator}
							style={`--status-color: ${diffColors[row.status]}`}
							title={localeStore.t('bom.tooltipOpenSch')}
							onclick={() => selectReference(row.designator)}
						>
							{#if projectStore.mode === 'compare'}
								<td><span class="status">{statusLabel(row.status)}</span></td>
							{/if}
							<td class="designator">
								{row.designator}
								{#if hiddenReason(row)}
									<span class="hidden-reason">{hiddenReason(row)}</span>
								{/if}
							</td>
							{#if projectStore.mode === 'view'}
								<td>{itemValueComment(row.before)}</td>
								{#if showAdvancedBomColumns}
									<td>{usefulText(row.before?.footprint) || '-'}</td>
									<td>{itemDescription(row.before)}</td>
									<td class="parameters" title={parameterText(row)}>{parameterText(row) || '-'}</td>
								{/if}
							{:else}
								<td>{itemText(row, 'before')}</td>
								<td>{itemText(row, 'after')}</td>
								<td>{summarize(row)}</td>
							{/if}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>

<style>
	.bom-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		border-bottom: 1px solid #e5e7eb;
		padding: 16px 18px;
	}

	.search {
		border: 1px solid #d0d5dd;
		border-radius: 6px;
		min-height: 36px;
		min-width: 280px;
		padding: 0 10px;
	}

	.bom-filters {
		display: flex;
		gap: 6px;
	}

	.bom-filters select {
		min-height: 36px;
		border: 1px solid #d0d5dd;
		border-radius: 6px;
		background: #ffffff;
		color: #344054;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 750;
		padding: 0 8px;
	}

	h2 {
		margin: 0 0 4px;
		font-size: 1.05rem;
	}

	p {
		margin: 0;
		color: #667085;
		font-size: 0.86rem;
	}

	.legend {
		display: flex;
		gap: 12px;
		color: #526070;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.export-actions {
		display: flex;
		gap: 6px;
	}

	.hidden-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #475467;
		font-size: 0.76rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.export-actions select,
	.export-actions button {
		border: 1px solid #c7d2fe;
		border-radius: 6px;
		background: #ffffff;
		color: #4f46e5;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		padding: 7px 9px;
	}

	.export-actions button {
		background: #eef2ff;
		cursor: pointer;
	}

	.export-actions button:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.legend span {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.legend .added {
		background: #16a34a;
	}

	.legend .removed {
		background: #dc2626;
	}

	.legend .modified {
		background: #f97316;
	}

	.table-wrap {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.86rem;
	}

	th,
	td {
		border-bottom: 1px solid #edf0f5;
		padding: 10px 12px;
		text-align: left;
		vertical-align: top;
	}

	th {
		position: sticky;
		top: 0;
		background: #f8fafc;
		color: #526070;
		font-size: 0.76rem;
		text-transform: uppercase;
		z-index: 1;
	}

	.sort-button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-weight: 900;
		padding: 0;
		text-align: left;
		text-transform: inherit;
	}

	.sort-button span {
		display: inline-block;
		min-width: 10px;
		color: #4f46e5;
		font-size: 0.62rem;
	}

	.sort-button:hover {
		color: #4f46e5;
	}

	tbody tr {
		border-left: 4px solid var(--status-color);
		cursor: pointer;
	}

	tbody tr:hover {
		background: #f8fafc;
	}

	tbody tr.selected {
		background: #fffbeb;
	}

	.status {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		background: color-mix(in srgb, var(--status-color) 14%, white);
		color: var(--status-color);
		font-weight: 800;
		min-height: 24px;
		padding: 0 9px;
	}

	.designator {
		color: #111827;
		font-weight: 800;
	}

	.hidden-reason {
		display: inline-block;
		margin-left: 7px;
		border-radius: 4px;
		background: #eef2ff;
		color: #4f46e5;
		font-size: 0.64rem;
		font-weight: 900;
		padding: 2px 5px;
		text-transform: uppercase;
		vertical-align: middle;
	}

	.parameters {
		max-width: 420px;
		color: #475467;
		font-size: 0.78rem;
	}

	.empty {
		color: #667085;
		text-align: center;
		padding: 36px;
	}
</style>
