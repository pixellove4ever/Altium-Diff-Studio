<script lang="ts">
	import { diffColors, getBomDiff, type BomDiffRow } from '$lib/diff/altiumDiff';
	import { projectStore } from '$lib/state/projectStore.svelte';

	const rows = $derived(getBomDiff(projectStore.projectA.bom, projectStore.projectB.bom));
	const visibleRows = $derived(rows.filter((row) => row.status !== 'unchanged'));

	function statusLabel(status: BomDiffRow['status']) {
		if (status === 'added') return 'Added';
		if (status === 'removed') return 'Removed';
		if (status === 'modified') return 'Modified';
		return 'Unchanged';
	}

	function summarize(row: BomDiffRow) {
		if (row.status === 'added') return 'Present only in version B';
		if (row.status === 'removed') return 'Present only in version A';
		if (row.status === 'modified') return row.changes.map((change) => change.field).join(', ');
		return '';
	}

	function itemText(row: BomDiffRow, side: 'before' | 'after') {
		const item = row[side];
		if (!item) return '-';

		return [item.comment, item.footprint, item.libRef, item.description].filter(Boolean).join(' | ');
	}
</script>

<div class="bom-view">
	<header>
		<div>
			<h2>BOM Diff</h2>
			<p>{visibleRows.length} differences, {rows.length} compared designators</p>
		</div>
		<div class="legend">
			<span><i class="added"></i>Added</span>
			<span><i class="removed"></i>Removed</span>
			<span><i class="modified"></i>Modified</span>
		</div>
	</header>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Status</th>
					<th>Designator</th>
					<th>Version A</th>
					<th>Version B</th>
					<th>Changed fields</th>
				</tr>
			</thead>
			<tbody>
				{#if visibleRows.length === 0}
					<tr>
						<td colspan="5" class="empty">No BOM difference detected.</td>
					</tr>
				{:else}
					{#each visibleRows as row}
						<tr
							class:selected={projectStore.selectedDesignator === row.designator}
							style={`--status-color: ${diffColors[row.status]}`}
							onclick={() => projectStore.selectDesignator(row.designator)}
						>
							<td><span class="status">{statusLabel(row.status)}</span></td>
							<td class="designator">{row.designator}</td>
							<td>{itemText(row, 'before')}</td>
							<td>{itemText(row, 'after')}</td>
							<td>{summarize(row)}</td>
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

	.empty {
		color: #667085;
		text-align: center;
		padding: 36px;
	}
</style>
