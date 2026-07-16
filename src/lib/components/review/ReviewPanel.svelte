<script lang="ts">
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { reviewStore, type ReviewFilter, type ReviewSourceFilter } from '$lib/state/reviewStore.svelte';

	const filters: ReviewFilter[] = ['all', 'pending', 'added', 'modified', 'removed'];
	const sources: Exclude<ReviewSourceFilter, 'all'>[] = ['pcb', 'schematic', 'bom'];
</script>

<details class="review-panel" open>
	<summary>
		<span>{localeStore.t('app.reviewChanges')}</span>
		<b>{reviewStore.reviewedCount}/{reviewStore.changes.length}</b>
	</summary>
	<div class="review-progress">
		<i
			style={`width:${reviewStore.changes.length > 0 ? (reviewStore.reviewedCount / reviewStore.changes.length) * 100 : 0}%`}
		></i>
	</div>
	<div class="review-stats" aria-label="Change summary">
		<span class="added" title="Added">{reviewStore.stats.statuses.added}</span>
		<span class="modified" title="Modified">{reviewStore.stats.statuses.modified}</span>
		<span class="removed" title="Removed">{reviewStore.stats.statuses.removed}</span>
		{#each sources as source}
			<button
				class:active={reviewStore.sourceFilter === source}
				title={`Filter ${source} changes`}
				onclick={() =>
					(reviewStore.sourceFilter =
						reviewStore.sourceFilter === source ? 'all' : source)}
			>
				{source === 'schematic' ? 'SCH' : source.toUpperCase()}
				{reviewStore.stats.sources[source]}
			</button>
		{/each}
	</div>
	<div class="export-review">
		<select bind:value={reviewStore.reportScope} aria-label={localeStore.t('app.reportScope')}>
			<option value="complete">{localeStore.t('app.completeReport')}</option>
			<option value="filtered">{localeStore.t('app.currentFilters')}</option>
		</select>
		<button disabled={reviewStore.changes.length === 0} onclick={() => reviewStore.exportHtml()}>
			HTML
		</button>
		<button
			disabled={reviewStore.changes.length === 0}
			onclick={() => void reviewStore.exportPdf()}
		>
			PDF
		</button>
		<button
			disabled={reviewStore.changes.length === 0}
			title={localeStore.t('app.exportReviewSession')}
			onclick={() => reviewStore.exportSession()}>{localeStore.t('app.sessionDown')}</button
		>
		<button
			disabled={reviewStore.changes.length === 0}
			title={localeStore.t('app.importReviewSession')}
			onclick={() => reviewStore.sessionInput?.click()}>{localeStore.t('app.sessionUp')}</button
		>
		<input
			class="review-session-input"
			bind:this={reviewStore.sessionInput}
			type="file"
			accept=".json,application/json"
			onchange={(event) => void reviewStore.importSession(event)}
		/>
	</div>
	<div class="session-options">
		<input
			bind:value={reviewStore.author}
			aria-label={localeStore.t('app.reviewAuthor')}
			placeholder={localeStore.t('app.reviewAuthor')}
			onchange={() => reviewStore.touch()}
		/>
		<select
			bind:value={reviewStore.sessionImportMode}
			aria-label={localeStore.t('app.sessionImportMode')}
		>
			<option value="merge">{localeStore.t('app.mergeImport')}</option>
			<option value="replace">{localeStore.t('app.replaceImport')}</option>
		</select>
		{#if reviewStore.modifiedAt}
			<small>
				{localeStore.t('app.lastModified', {
					date: new Date(reviewStore.modifiedAt).toLocaleString()
				})}
				{reviewStore.author ? ` - ${reviewStore.author}` : ''}
			</small>
		{/if}
	</div>
	<div class="review-filters">
		{#each filters as filter}
			<button
				class:active={reviewStore.filter === filter}
				onclick={() => (reviewStore.filter = filter)}
			>
				{filter === 'all'
					? localeStore.t('app.filterAll')
					: filter === 'pending'
						? localeStore.t('app.filterToReview')
						: filter.slice(0, 1).toUpperCase()}
			</button>
		{/each}
	</div>
	<div class="review-list">
		{#each reviewStore.visibleChanges as change}
			<div
				class:reviewed={reviewStore.reviewedChanges.has(change.key)}
				class={`review-item ${change.status}`}
			>
				<button class="review-main" onclick={() => reviewStore.openItem(change)}>
					<strong>{change.kind === 'net' ? 'NET' : change.designator}</strong>
					<span>
						{change.kind === 'net' ? `${change.value} - ${change.summary}` : change.summary}
					</span>
				</button>
				<div class="review-sources">
					{#each change.sources as source}
						<button
							title={`Open in ${source}`}
							onclick={() => reviewStore.openItem(change, source)}
						>
							{source === 'schematic' ? 'SCH' : source.toUpperCase()}
						</button>
					{/each}
					<button
						class="review-check"
						title="Mark as reviewed"
						onclick={() => reviewStore.toggleReviewed(change.key)}
					>
						{reviewStore.reviewedChanges.has(change.key) ? 'OK' : '--'}
					</button>
				</div>
			</div>
		{/each}
		{#if reviewStore.visibleChanges.length === 0}
			<p>{localeStore.t('app.noChangeInFilter')}</p>
		{/if}
	</div>
</details>
