<script lang="ts">
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { reviewStore, type ReviewChange } from '$lib/state/reviewStore.svelte';

	let {
		change,
		kind = 'component'
	}: {
		change: ReviewChange;
		kind?: 'component' | 'net';
	} = $props();

	const snapshot = $derived(reviewStore.snapshots[change.key]);
</script>

{#if kind === 'net'}
	<section class="net-review-card">
		<div>
			<strong>{change.value}</strong>
			<button onclick={() => reviewStore.toggleReviewed(change.key)}>
				{reviewStore.reviewedChanges.has(change.key)
					? localeStore.t('app.reviewedStatus')
					: localeStore.t('app.markReviewed')}
			</button>
		</div>
		<small>{change.summary}</small>
		<textarea
			rows="3"
			placeholder={localeStore.t('app.routingReviewNote')}
			value={reviewStore.notes[change.key] ?? ''}
			oninput={(event) =>
				reviewStore.updateNote(change.key, (event.currentTarget as HTMLTextAreaElement).value)}
		></textarea>
		<div class="snapshot-actions">
			<button onclick={() => reviewStore.captureSnapshot(change.key)}>
				{snapshot ? localeStore.t('app.replaceSnapshot') : localeStore.t('app.captureView')}
			</button>
			{#if snapshot}
				<button onclick={() => reviewStore.removeSnapshot(change.key)}
					>{localeStore.t('app.remove')}</button
				>
			{/if}
		</div>
		{#if snapshot}
			<figure class="review-snapshot">
				<img src={snapshot.dataUrl} alt={`${change.value} review snapshot`} />
				<figcaption>
					{snapshot.view} - {new Date(snapshot.capturedAt).toLocaleString()}
				</figcaption>
			</figure>
		{/if}
	</section>
{:else}
	<div class="review-note">
		<div>
			<strong>{localeStore.t('app.reviewNote')}</strong>
			<button onclick={() => reviewStore.toggleReviewed(change.key)}>
				{reviewStore.reviewedChanges.has(change.key)
					? localeStore.t('app.reviewedStatus')
					: localeStore.t('app.markReviewed')}
			</button>
		</div>
		<textarea
			rows="3"
			placeholder={localeStore.t('app.decisionPlaceholder')}
			value={reviewStore.notes[change.key] ?? ''}
			oninput={(event) =>
				reviewStore.updateNote(change.key, (event.currentTarget as HTMLTextAreaElement).value)}
		></textarea>
		<div class="snapshot-actions">
			<button onclick={() => reviewStore.captureSnapshot(change.key)}>
				{snapshot ? localeStore.t('app.replaceSnapshot') : localeStore.t('app.captureView')}
			</button>
			{#if snapshot}
				<button onclick={() => reviewStore.removeSnapshot(change.key)}
					>{localeStore.t('app.remove')}</button
				>
			{/if}
		</div>
		{#if snapshot}
			<figure class="review-snapshot">
				<img src={snapshot.dataUrl} alt={`${change.value} review snapshot`} />
				<figcaption>
					{snapshot.view} - {new Date(snapshot.capturedAt).toLocaleString()}
				</figcaption>
			</figure>
		{/if}
	</div>
{/if}
