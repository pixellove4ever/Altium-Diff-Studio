<script lang="ts">
	import { diffColors, getBomDiff, type BomDiffRow } from '$lib/diff/altiumDiff';
	import { createBomDiffCsv } from '$lib/domain/bomDiffExport';
	import { bomViewerHiddenReason, shouldShowBomItemInViewer } from '$lib/domain/bomVisibility';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';

	const rows = $derived(
		getBomDiff(
			projectStore.projectA.bom,
			projectStore.mode === 'view' ? projectStore.projectA.bom : projectStore.projectB.bom
		)
	);
	let query = $state('');
	let exportScope = $state<'complete' | 'filtered'>('complete');
	let showHiddenBomRefs = $state(false);
	const viewerRows = $derived(
		rows.filter((row) => shouldShowBomItemInViewer(row.after ?? row.before ?? undefined))
	);
	const hiddenViewerRowCount = $derived(rows.length - viewerRows.length);
	const visibleRows = $derived.by(() => {
		const candidates =
			projectStore.mode === 'view'
				? showHiddenBomRefs && !viewerStore.minimalUi
					? rows
					: viewerRows
				: rows.filter((row) => row.status !== 'unchanged');
		const needle = query.trim().toLowerCase();
		if (!needle) return candidates;
		return candidates.filter((row) => {
			const item = row.after ?? row.before;
			return [
				row.designator,
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
	});

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
					{#if projectStore.mode === 'compare'}<th>{localeStore.t('bom.statusColumn')}</th>{/if}
					<th>{localeStore.t('bom.designatorColumn')}</th>
					{#if projectStore.mode === 'view'}
						<th>{localeStore.t('bom.valueCommentColumn')}</th>
						<th>{localeStore.t('bom.footprintColumn')}</th>
						<th>{localeStore.t('bom.descriptionColumn')}</th>
						<th>{localeStore.t('bom.parametersColumn')}</th>
					{:else}
						<th>{localeStore.t('bom.versionAColumn')}</th>
						<th>{localeStore.t('bom.versionBColumn')}</th>
						<th>{localeStore.t('bom.changedFieldsColumn')}</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#if visibleRows.length === 0}
					<tr>
						<td colspan={5} class="empty">{localeStore.t('bom.noData')}</td>
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
								<td>{usefulText(row.before?.footprint) || '-'}</td>
								<td>{itemDescription(row.before)}</td>
								<td class="parameters" title={parameterText(row)}>{parameterText(row) || '-'}</td>
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
