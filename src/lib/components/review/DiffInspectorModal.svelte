<script lang="ts">
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { reviewStore } from '$lib/state/reviewStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';

	let {
		onClose
	}: {
		onClose?: () => void;
	} = $props();

	const designator = $derived(projectStore.selectedDesignator);
	const net = $derived(projectStore.selectedNet);

	const compA = $derived(
		designator ? (projectStore.indexA.byDesignator.get(designator.toUpperCase()) ?? null) : null
	);
	const compB = $derived(
		designator ? (projectStore.indexB.byDesignator.get(designator.toUpperCase()) ?? null) : null
	);

	const status = $derived.by<'added' | 'removed' | 'modified' | 'unchanged'>(() => {
		if (compA && !compB) return 'removed';
		if (!compA && compB) return 'added';
		if (!compA && !compB) return 'unchanged';
		const valA = compA?.bom?.comment || compA?.schematic?.comment || compA?.pcb?.comment;
		const valB = compB?.bom?.comment || compB?.schematic?.comment || compB?.pcb?.comment;
		const fpA = compA?.bom?.footprint || compA?.pcb?.footprint;
		const fpB = compB?.bom?.footprint || compB?.pcb?.footprint;
		if (valA !== valB || fpA !== fpB) return 'modified';
		return 'unchanged';
	});

	function close() {
		if (onClose) onClose();
		else projectStore.selectedDesignator = null;
	}
</script>

{#if designator && (compA || compB)}
	<div
		class="diff-inspector-overlay"
		role="presentation"
		onclick={close}
		onkeydown={(e) => {
			if (e.key === 'Escape') close();
		}}
	>
		<div
			class="diff-inspector-card"
			role="dialog"
			aria-label="Inspecteur de composant"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Escape') close();
			}}
		>
			<header class="inspector-header">
				<div class="title-group">
					<span class="badge-status {status}">{status.toUpperCase()}</span>
					<h3>{designator}</h3>
					<span class="category">{compB?.category ?? compA?.category ?? ''}</span>
				</div>
				<button class="close-btn" aria-label="Fermer" onclick={close}>✕</button>
			</header>

			<div class="inspector-body">
				<div class="version-column version-a">
					<div class="version-badge">Version Vn (A)</div>
					{#if compA}
						<dl>
							<dt>Valeur</dt>
							<dd>{compA.bom?.comment || compA.schematic?.comment || compA.pcb?.comment || '-'}</dd>

							<dt>Empreinte (Footprint)</dt>
							<dd>{compA.bom?.footprint || compA.pcb?.footprint || '-'}</dd>

							<dt>Couche PCB</dt>
							<dd>{compA.pcb?.layer || '-'}</dd>

							<dt>Position X, Y</dt>
							<dd>{compA.pcb ? `${compA.pcb.x.toFixed(2)}, ${compA.pcb.y.toFixed(2)}` : '-'}</dd>

							<dt>Fabricant / MPN</dt>
							<dd>
								{compA.parameters.Manufacturer || '-'} /
								{compA.parameters.PartNumber || compA.parameters.MPN || '-'}
							</dd>

							<dt>Nets connectés</dt>
							<dd class="nets">{compA.nets.join(', ') || '-'}</dd>
						</dl>
					{:else}
						<p class="absent-notice">Non présent en Version A (Composant Ajouté)</p>
					{/if}
				</div>

				<div class="version-column version-b">
					<div class="version-badge">Version Vn+1 (B)</div>
					{#if compB}
						<dl>
							<dt>Valeur</dt>
							<dd
								class:diff-highlight={(compA?.bom?.comment || compA?.schematic?.comment) !==
									(compB.bom?.comment || compB.schematic?.comment)}
							>
								{compB.bom?.comment || compB.schematic?.comment || compB.pcb?.comment || '-'}
							</dd>

							<dt>Empreinte (Footprint)</dt>
							<dd
								class:diff-highlight={(compA?.bom?.footprint || compA?.pcb?.footprint) !==
									(compB.bom?.footprint || compB.pcb?.footprint)}
							>
								{compB.bom?.footprint || compB.pcb?.footprint || '-'}
							</dd>

							<dt>Couche PCB</dt>
							<dd class:diff-highlight={compA?.pcb?.layer !== compB.pcb?.layer}>
								{compB.pcb?.layer || '-'}
							</dd>

							<dt>Position X, Y</dt>
							<dd>
								{compB.pcb ? `${compB.pcb.x.toFixed(2)}, ${compB.pcb.y.toFixed(2)}` : '-'}
							</dd>

							<dt>Fabricant / MPN</dt>
							<dd>
								{compB.parameters.Manufacturer || '-'} /
								{compB.parameters.PartNumber || compB.parameters.MPN || '-'}
							</dd>

							<dt>Nets connectés</dt>
							<dd class="nets">{compB.nets.join(', ') || '-'}</dd>
						</dl>
					{:else}
						<p class="absent-notice">Non présent en Version B (Composant Supprimé)</p>
					{/if}
				</div>
			</div>

			<footer class="inspector-footer">
				<button
					class="action-btn"
					onclick={() => {
						projectStore.activeTab = 'bom';
						close();
					}}
				>
					Voir dans le tableau BOM
				</button>
				<button
					class="action-btn primary"
					onclick={() => {
						reviewStore.openChange(designator, 'pcb');
						close();
					}}
				>
					Ouvrir les notes de révision
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.diff-inspector-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.45);
		backdrop-filter: blur(4px);
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.diff-inspector-card {
		background: #ffffff;
		border-radius: 12px;
		box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
		width: 100%;
		max-width: 680px;
		overflow: hidden;
		border: 1px solid #e2e8f0;
		display: flex;
		flex-direction: column;
	}

	.inspector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		background: #f8fafc;
		border-bottom: 1px solid #e2e8f0;
	}

	.title-group {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.title-group h3 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
		color: #0f172a;
	}

	.category {
		font-size: 12px;
		color: #64748b;
		background: #e2e8f0;
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 600;
	}

	.badge-status {
		font-size: 11px;
		font-weight: 700;
		padding: 3px 8px;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.badge-status.added {
		background: #dcfce7;
		color: #15803d;
	}

	.badge-status.removed {
		background: #fee2e2;
		color: #b91c1c;
	}

	.badge-status.modified {
		background: #fef3c7;
		color: #b45309;
	}

	.badge-status.unchanged {
		background: #f1f5f9;
		color: #64748b;
	}

	.close-btn {
		background: transparent;
		border: none;
		font-size: 16px;
		color: #64748b;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 6px;
	}

	.close-btn:hover {
		background: #e2e8f0;
		color: #0f172a;
	}

	.inspector-body {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		padding: 20px;
		background: #ffffff;
	}

	.version-column {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 14px;
	}

	.version-badge {
		font-size: 12px;
		font-weight: 700;
		color: #475569;
		margin-bottom: 12px;
		padding-bottom: 6px;
		border-bottom: 1px solid #cbd5e1;
		text-transform: uppercase;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		row-gap: 8px;
		column-gap: 10px;
		font-size: 13px;
		margin: 0;
	}

	dt {
		font-weight: 600;
		color: #64748b;
	}

	dd {
		margin: 0;
		color: #0f172a;
		word-break: break-word;
	}

	.diff-highlight {
		background: #fef08a;
		padding: 1px 4px;
		border-radius: 3px;
		font-weight: 700;
		color: #854d0e;
	}

	.absent-notice {
		font-size: 13px;
		color: #94a3b8;
		font-style: italic;
		text-align: center;
		padding: 30px 0;
	}

	.inspector-footer {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding: 14px 20px;
		background: #f8fafc;
		border-top: 1px solid #e2e8f0;
	}

	.action-btn {
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 600;
		border-radius: 6px;
		border: 1px solid #cbd5e1;
		background: #ffffff;
		color: #334155;
		cursor: pointer;
	}

	.action-btn:hover {
		background: #f1f5f9;
	}

	.action-btn.primary {
		background: #2563eb;
		color: #ffffff;
		border-color: #1d4ed8;
	}

	.action-btn.primary:hover {
		background: #1d4ed8;
	}
</style>
