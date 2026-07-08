<script lang="ts">
	import {
		compareGerberFiles,
		gerberLayerLabel,
		normalizeGerberLines,
		parseGerberGeometry,
		type GerberBounds,
		type GerberFile
	} from '$lib/diff/fabrication/gerberDiff';
	import { formatFileSize, type OdbPackageFile } from '$lib/domain/fabrication/files';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';

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
	const selectedGeometry = $derived(selectedFile ? parseGerberGeometry(selectedFile.text) : null);

	function gerberViewBox(bounds: GerberBounds) {
		const width = Math.max(1, bounds.maxX - bounds.minX);
		const height = Math.max(1, bounds.maxY - bounds.minY);
		const padding = Math.max(width, height) * 0.04 || 1;
		return `${bounds.minX - padding} ${-bounds.maxY - padding} ${width + padding * 2} ${height + padding * 2}`;
	}

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
						<small>
							{formatFileSize(odb.size)}
							{#if odb.summary && odb.summary.entryCount > 0}
								/ {odb.summary.layers.length} layers
							{/if}
						</small>
					</article>
				{/each}
			</div>
		{/if}
		<div class="layer-list">
			{#if activeFiles.length > 0}<h3>Gerber / Drill</h3>{/if}
			{#each activeFiles as file}
				{@const lineCount = normalizeGerberLines(file.text).length}
				<button
					class:selected={selectedFile?.name === file.name}
					onclick={() => (selectedKey = file.name)}
				>
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
				{#each odbPackages as odb}
					{@const summary = odb.summary}
					{#if summary && summary.entryCount > 0}
						<div class="odb-metadata">
							<span>{summary.entryCount} entries</span>
							<span>{summary.steps.length} steps</span>
							<span>{summary.layers.length} layers</span>
							<span>{summary.drillLayers.length} drill layers</span>
							{#if summary.layerTypeCounts.copper > 0}
								<span>{summary.layerTypeCounts.copper} copper</span>
							{/if}
							{#if summary.layerTypeCounts.mask > 0}
								<span>{summary.layerTypeCounts.mask} mask</span>
							{/if}
							{#if summary.layerTypeCounts.paste > 0}
								<span>{summary.layerTypeCounts.paste} paste</span>
							{/if}
							{#if summary.layerTypeCounts.silk > 0}
								<span>{summary.layerTypeCounts.silk} silk</span>
							{/if}
							{#if summary.parsedTextEntryCount > 0}
								<span>{summary.parsedTextEntryCount} parsed files</span>
							{/if}
							<span class:available={summary.hasPlacements}>placements</span>
							<span class:available={summary.hasNets}>nets</span>
						</div>
						{#if summary.layers.length > 0}
							<p>{summary.layers.slice(0, 12).join(', ')}</p>
						{/if}
						{#if Object.keys(summary.layerFeatureCounts).length > 0}
							<p>
								{Object.entries(summary.layerFeatureCounts)
									.slice(0, 8)
									.map(([layer, count]) => `${layer}: ${count}`)
									.join(', ')}
							</p>
						{/if}
						{#if summary.components.length > 0 || summary.nets.length > 0}
							<p>
								{summary.components.length} components / {summary.nets.length} nets extracted
							</p>
						{/if}
					{:else if summary?.unsupportedCompression}
						<span>
							Compressed ODB++ intake is tracked, but archive decompression is not available yet.
							Gerber remains available as fallback.
						</span>
					{:else}
						<span>
							ODB++ package is tracked. Layer, drill, placement and net extraction needs an expanded
							package parser for this archive.
						</span>
					{/if}
				{/each}
			</div>
		{/if}
		{#if selectedFile}
			<header class="file-header">
				<div>
					<strong>{gerberLayerLabel(selectedFile.name)}</strong>
					<span>{selectedFile.path ?? selectedFile.name}</span>
				</div>
				<b>{selectedGeometry?.primitives.length ?? 0} primitives / {selectedLines.length} lines</b>
			</header>
			{#if selectedGeometry && selectedGeometry.bounds && selectedGeometry.primitives.length > 0}
				<div class="gerber-preview">
					<svg viewBox={gerberViewBox(selectedGeometry.bounds)} aria-label="Gerber layer preview">
						<g transform="scale(1 -1)">
							{#each selectedGeometry.primitives as primitive}
								{#if primitive.type === 'draw'}
									<line
										x1={primitive.from.x}
										y1={primitive.from.y}
										x2={primitive.to.x}
										y2={primitive.to.y}
										stroke-width={Math.max(primitive.width, 0.02)}
									/>
								{:else if primitive.shape === 'rectangle'}
									<rect
										x={primitive.at.x - primitive.width / 2}
										y={primitive.at.y - primitive.height / 2}
										width={primitive.width}
										height={primitive.height}
									/>
								{:else if primitive.shape === 'obround'}
									<rect
										x={primitive.at.x - primitive.width / 2}
										y={primitive.at.y - primitive.height / 2}
										width={primitive.width}
										height={primitive.height}
										rx={Math.min(primitive.width, primitive.height) / 2}
										ry={Math.min(primitive.width, primitive.height) / 2}
									/>
								{:else}
									<circle
										cx={primitive.at.x}
										cy={primitive.at.y}
										r={Math.max(primitive.width, primitive.height) / 2}
									/>
								{/if}
							{/each}
						</g>
					</svg>
					<div class="preview-status">
						<span>{selectedGeometry.unit.toUpperCase()}</span>
						<span>{selectedGeometry.primitives.length} rendered primitives</span>
						{#if selectedGeometry.unsupportedCount > 0}
							<span>{selectedGeometry.unsupportedCount} commands skipped</span>
						{/if}
					</div>
				</div>
			{:else}
				<div class="empty">
					<strong>No visual primitives detected</strong>
					<span>The raw Gerber content is still available in Advanced mode.</span>
				</div>
			{/if}
			{#if !viewerStore.minimalUi}
				<pre>{selectedLines.slice(0, 500).join('\n')}</pre>
			{/if}
		{:else if odbPackages.length > 0}
			<div class="empty">
				<strong>ODB++ parser pending</strong>
				<span
					>The package is loaded and tracked. Layer, drill, placement and net extraction comes next.</span
				>
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
		display: flex;
		flex-direction: column;
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
		gap: 8px;
		border-bottom: 1px solid #bfdbfe;
		background: #eff6ff;
		color: #1e3a8a;
		padding: 10px 14px;
	}

	.odb-summary > span,
	.odb-summary p {
		margin: 0;
		color: #475569;
		font-size: 0.78rem;
	}

	.odb-metadata {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.odb-metadata span {
		border: 1px solid #bfdbfe;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.7);
		color: #475569;
		padding: 4px 7px;
		font-size: 0.68rem;
		font-weight: 800;
	}

	.odb-metadata span.available {
		border-color: #86efac;
		background: #dcfce7;
		color: #166534;
	}

	.gerber-preview {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		background:
			linear-gradient(#eef2f6 1px, transparent 1px),
			linear-gradient(90deg, #eef2f6 1px, transparent 1px), #f8fafc;
		background-size: 28px 28px;
	}

	.gerber-preview svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.gerber-preview line,
	.gerber-preview rect,
	.gerber-preview circle {
		fill: #2563eb;
		stroke: #1d4ed8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.gerber-preview line {
		fill: none;
	}

	.preview-status {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		max-width: calc(100% - 24px);
	}

	.preview-status span {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.9);
		color: #475569;
		padding: 4px 7px;
		font-size: 0.68rem;
		font-weight: 800;
	}

	pre {
		flex: 0 0 min(38%, 260px);
		min-width: 0;
		min-height: 140px;
		margin: 0;
		overflow: auto;
		border-top: 1px solid #1e293b;
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
