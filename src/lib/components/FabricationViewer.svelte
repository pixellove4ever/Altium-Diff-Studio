<script lang="ts">
	import {
		compareGerberFiles,
		gerberLayerLabel,
		normalizeGerberLines,
		type GerberFile
	} from '$lib/diff/fabrication/gerberDiff';
	import { formatFileSize, type OdbPackageFile } from '$lib/domain/fabrication/files';
	import { projectStore } from '$lib/state/projectStore.svelte';

	let {
		files = projectStore.gerberA,
		odbPackages = projectStore.odbA
	}: { files?: GerberFile[]; odbPackages?: OdbPackageFile[] } = $props();

	let selectedKey = $state('');
	const summary = $derived(compareGerberFiles(projectStore.gerberA, projectStore.gerberB));
	const activeFiles = $derived(files.length > 0 ? files : projectStore.gerberA);
	const selectedFile = $derived.by(() => {
		if (activeFiles.length === 0) return null;
		return (
			activeFiles.find((file) => file.name.toLowerCase() === selectedKey.toLowerCase()) ??
			activeFiles[0]
		);
	});
	const selectedLines = $derived(selectedFile ? normalizeGerberLines(selectedFile.text) : []);

	$effect(() => {
		if (!selectedFile) selectedKey = '';
		else if (!selectedKey) selectedKey = selectedFile.name;
	});
</script>

<section class="fabrication-viewer">
	<aside>
		<header>
			<strong>Fabrication</strong>
			<span>{activeFiles.length} Gerber / {odbPackages.length} ODB++</span>
		</header>
		{#if odbPackages.length > 0}
			<div class="odb-list">
				<h3>ODB++</h3>
				{#each odbPackages as odb}
					<article>
						<strong>{odb.name}</strong>
						<span>{odb.path ?? odb.name}</span>
						<small>{formatFileSize(odb.size)}</small>
					</article>
				{/each}
			</div>
		{/if}
		<div class="layer-list">
			{#if activeFiles.length > 0}<h3>Gerber / Drill</h3>{/if}
			{#each activeFiles as file}
				{@const lineCount = normalizeGerberLines(file.text).length}
				<button class:selected={selectedFile?.name === file.name} onclick={() => (selectedKey = file.name)}>
					<strong>{gerberLayerLabel(file.name)}</strong>
					<span>{file.name}</span>
					<small>{lineCount} lines</small>
				</button>
			{/each}
			{#if activeFiles.length === 0}
				<p>No Gerber file loaded.</p>
			{/if}
		</div>
	</aside>

	<div class="gerber-main">
		{#if projectStore.mode === 'compare' && (projectStore.gerberA.length > 0 || projectStore.gerberB.length > 0)}
			<div class="diff-summary">
				<span>{summary.counts.unchanged} unchanged</span>
				<span class="added">{summary.counts.added} added</span>
				<span class="modified">{summary.counts.modified} modified</span>
				<span class="removed">{summary.counts.removed} removed</span>
			</div>
		{/if}
		{#if odbPackages.length > 0}
			<div class="odb-summary">
				<strong>ODB++ package loaded</strong>
				<span>
					ODB++ will become the preferred source for fabrication, placement and net-aware PCB
					viewing when the parser is added. Gerber remains available as fallback.
				</span>
			</div>
		{/if}
		{#if selectedFile}
			<header class="file-header">
				<div>
					<strong>{gerberLayerLabel(selectedFile.name)}</strong>
					<span>{selectedFile.path ?? selectedFile.name}</span>
				</div>
				<b>{selectedLines.length} lines</b>
			</header>
			<pre>{selectedLines.slice(0, 500).join('\n')}</pre>
		{:else if odbPackages.length > 0}
			<div class="empty">
				<strong>ODB++ parser pending</strong>
				<span>The package is loaded and tracked. Layer, drill, placement and net extraction comes next.</span>
			</div>
		{:else}
			<div class="empty">
				<strong>Fabrication viewer</strong>
				<span>Drop ODB++, Gerber or drill files with the project export.</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.fabrication-viewer {
		display: grid;
		grid-template-columns: 260px minmax(0, 1fr);
		width: 100%;
		height: 100%;
		min-height: 0;
		background: #f8fafc;
	}

	aside {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-right: 1px solid #dbe2ec;
		background: #ffffff;
	}

	aside header,
	.file-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid #e5e7eb;
		padding: 12px 14px;
	}

	aside header div,
	.file-header div {
		min-width: 0;
	}

	aside span,
	.file-header span {
		color: #64748b;
		font-size: 0.76rem;
		overflow-wrap: anywhere;
	}

	.odb-list,
	.layer-list {
		flex: 1;
		overflow: auto;
		padding: 8px;
	}

	.odb-list {
		flex: 0 0 auto;
		border-bottom: 1px solid #eef2f6;
	}

	h3 {
		margin: 4px 4px 8px;
		color: #64748b;
		font-size: 0.68rem;
		text-transform: uppercase;
	}

	.odb-list article {
		display: grid;
		gap: 3px;
		border: 1px solid #dbeafe;
		border-radius: 6px;
		background: #eff6ff;
		padding: 8px;
	}

	.odb-list article + article {
		margin-top: 6px;
	}

	.odb-list article small {
		color: #2563eb;
		font-size: 0.68rem;
		font-weight: 800;
	}

	.layer-list button {
		display: grid;
		gap: 3px;
		width: 100%;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: #111827;
		padding: 8px;
		text-align: left;
	}

	.layer-list button:hover,
	.layer-list button.selected {
		border-color: #bfdbfe;
		background: #eff6ff;
	}

	.layer-list small {
		color: #64748b;
		font-size: 0.68rem;
	}

	.layer-list p,
	.empty {
		color: #64748b;
		font-size: 0.84rem;
	}

	.gerber-main {
		display: grid;
		grid-template-rows: auto auto auto minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
	}

	.diff-summary {
		display: flex;
		gap: 8px;
		border-bottom: 1px solid #e5e7eb;
		background: #ffffff;
		padding: 8px 12px;
		color: #64748b;
		font-size: 0.76rem;
		font-weight: 800;
	}

	.diff-summary .added {
		color: #15803d;
	}

	.diff-summary .modified {
		color: #c2410c;
	}

	.diff-summary .removed {
		color: #b91c1c;
	}

	.file-header b {
		color: #475569;
		font-size: 0.76rem;
	}

	.odb-summary {
		display: grid;
		gap: 4px;
		border-bottom: 1px solid #bfdbfe;
		background: #eff6ff;
		color: #1e3a8a;
		padding: 10px 14px;
	}

	.odb-summary span {
		color: #475569;
		font-size: 0.78rem;
	}

	pre {
		min-width: 0;
		min-height: 0;
		margin: 0;
		overflow: auto;
		background: #0f172a;
		color: #dbeafe;
		font-size: 0.72rem;
		line-height: 1.45;
		padding: 14px;
	}

	.empty {
		display: grid;
		place-content: center;
		gap: 6px;
		width: 100%;
		height: 100%;
		text-align: center;
	}

	.empty strong {
		color: #111827;
		font-size: 1rem;
	}
</style>
