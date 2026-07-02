<script lang="ts">
	import { diffColors, getBomDiff, type BomDiffRow } from '$lib/diff/altiumDiff';
	import { projectStore } from '$lib/state/projectStore.svelte';

	const rows = $derived(
		getBomDiff(
			projectStore.projectA.bom,
			projectStore.mode === 'view' ? projectStore.projectA.bom : projectStore.projectB.bom
		)
	);
	let query = $state('');
	const visibleRows = $derived.by(() => {
		const candidates =
			projectStore.mode === 'view' ? rows : rows.filter((row) => row.status !== 'unchanged');
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

		return [item.comment, item.footprint, item.libRef, item.description]
			.filter(Boolean)
			.join(' | ');
	}

	function parameterText(row: BomDiffRow) {
		return Object.entries((row.after ?? row.before)?.parameters ?? {})
			.filter(([, value]) => value)
			.map(([key, value]) => `${key}: ${value}`)
			.join(' · ');
	}
</script>

<div class="bom-view">
	<header>
		<div>
			<h2>{projectStore.mode === 'view' ? 'BOM' : 'BOM Diff'}</h2>
			<p>
				{projectStore.mode === 'view'
					? `${rows.length} designators`
					: `${visibleRows.length} differences, ${rows.length} compared designators`}
			</p>
		</div>
		<input
			class="search"
			bind:value={query}
			placeholder="Search designator, MPN, value, footprint…"
		/>
		{#if projectStore.mode === 'compare'}
			<div class="legend">
				<span><i class="added"></i>Added</span>
				<span><i class="removed"></i>Removed</span>
				<span><i class="modified"></i>Modified</span>
			</div>
		{/if}
	</header>

	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					{#if projectStore.mode === 'compare'}<th>Status</th>{/if}
					<th>Designator</th>
					{#if projectStore.mode === 'view'}
						<th>Value / comment</th>
						<th>Footprint</th>
						<th>Description</th>
						<th>Parameters</th>
					{:else}
						<th>Version A</th>
						<th>Version B</th>
						<th>Changed fields</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#if visibleRows.length === 0}
					<tr>
						<td colspan={5} class="empty">No BOM data found.</td>
					</tr>
				{:else}
					{#each visibleRows as row}
						<tr
							class:selected={projectStore.selectedDesignator === row.designator}
							style={`--status-color: ${diffColors[row.status]}`}
							onclick={() => projectStore.selectDesignator(row.designator)}
						>
							{#if projectStore.mode === 'compare'}
								<td><span class="status">{statusLabel(row.status)}</span></td>
							{/if}
							<td class="designator">{row.designator}</td>
							{#if projectStore.mode === 'view'}
								<td>{row.before?.comment || '-'}</td>
								<td>{row.before?.footprint || '-'}</td>
								<td>{row.before?.description || row.before?.libRef || '-'}</td>
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
