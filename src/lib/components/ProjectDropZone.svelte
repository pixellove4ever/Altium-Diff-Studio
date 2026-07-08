<script lang="ts">
	import { projectStore, type VersionSide } from '$lib/state/projectStore.svelte';
	import { importStore } from '$lib/state/importStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';

	let { side, title }: { side: VersionSide; title: string } = $props();

	let isDragging = $state(false);
	const files = $derived(side === 'A' ? projectStore.filesA : projectStore.filesB);
	const pdf = $derived(side === 'A' ? projectStore.pdfA : projectStore.pdfB);
	const dxfs = $derived(side === 'A' ? projectStore.dxfA : projectStore.dxfB);
	const gerbers = $derived(side === 'A' ? projectStore.gerberA : projectStore.gerberB);
	const odbs = $derived(side === 'A' ? projectStore.odbA : projectStore.odbB);
	const isLoading = $derived(importStore.loadingSide === side);

	function onInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files) importStore.loadBrowserFiles(side, input.files);
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		if (event.dataTransfer?.files) {
			importStore.loadBrowserFiles(side, event.dataTransfer.files);
		}
	}
</script>

<section
	role="group"
	aria-label={`${title} JSON drop zone`}
	class:dragging={isDragging}
	class:loading={isLoading}
	class="drop-zone"
	aria-busy={isLoading}
	ondragenter={() => (isDragging = true)}
	ondragleave={() => (isDragging = false)}
	ondragover={(event) => event.preventDefault()}
	ondrop={onDrop}
>
	<header>
		<span class="side"
			>{projectStore.mode === 'view'
				? localeStore.t('drop.single')
				: localeStore.t('drop.version', { side })}</span
		>
		<h2>{title}</h2>
	</header>

	{#if isLoading}
		<div class="loading-state" role="status">
			<span class="spinner"></span>
			{importStore.loadingMessage}
		</div>
	{/if}

	<label class="picker">
		<input
			type="file"
			accept=".json,.pdf,.dxf,.gbr,.ger,.pho,.art,.gtl,.gbl,.gts,.gbs,.gtp,.gbp,.gto,.gbo,.gm1,.gm2,.gko,.gml,.drl,.xln,.odb,.odb++,.tgz,.tar,.gz,.zip,application/json,application/pdf"
			multiple
			onchange={onInput}
		/>
		<span>{localeStore.t('drop.select')}</span>
	</label>

	{#if files.length > 0}
		<ul>
			{#each files as file}
				<li>
					<strong>{file.doc.type}</strong>
					<span class="file-meta">
						<span class="file-name">{file.name}</span>
						<span class="exporter">
							{localeStore.t('drop.exporter')}
							{#if file.doc.exportMeta}
								{file.doc.exportMeta.scriptName ?? localeStore.t('drop.unknownScript')}
								{file.doc.exportMeta.scriptVersion ? ` ${file.doc.exportMeta.scriptVersion}` : ''}
								{file.doc.exportMeta.schemaVersion ? ` / ${file.doc.exportMeta.schemaVersion}` : ''}
							{:else}
								{localeStore.t('drop.legacy')}
							{/if}
						</span>
						<span class="file-path" title={file.path ?? file.name}>{file.path ?? file.name}</span>
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p>{localeStore.t('drop.hint')}</p>
	{/if}
	{#if pdf}
		<ul>
			<li>
				<strong>Smart PDF</strong>
				<span class="file-meta">
					<span class="file-name">{pdf.name}</span>
					<span class="file-path" title={pdf.path ?? pdf.name}>{pdf.path ?? pdf.name}</span>
				</span>
			</li>
		</ul>
	{/if}
	{#if dxfs.length > 0}
		<ul>
			<li class="artifact-summary">
				<strong>DXF</strong>
				<span>{localeStore.t('drop.sheetsLoaded', { count: dxfs.length })}</span>
			</li>
			{#each dxfs as dxf}
				<li>
					<strong>DXF</strong>
					<span class="file-meta">
						<span class="file-name">{dxf.name}</span>
						<span class="file-path" title={dxf.path ?? dxf.name}>{dxf.path ?? dxf.name}</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if gerbers.length > 0}
		<ul>
			<li class="artifact-summary">
				<strong>Gerber</strong>
				<span>{gerbers.length} layers loaded</span>
			</li>
			{#each gerbers as gerber}
				<li>
					<strong>Gerber</strong>
					<span class="file-meta">
						<span class="file-name">{gerber.name}</span>
						<span class="file-path" title={gerber.path ?? gerber.name}
							>{gerber.path ?? gerber.name}</span
						>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if odbs.length > 0}
		<ul>
			<li class="artifact-summary">
				<strong>ODB++</strong>
				<span>{odbs.length} package{odbs.length > 1 ? 's' : ''} loaded</span>
			</li>
			{#each odbs as odb}
				<li>
					<strong>ODB++</strong>
					<span class="file-meta">
						<span class="file-name">{odb.name}</span>
						<span class="file-path" title={odb.path ?? odb.name}>{odb.path ?? odb.name}</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.drop-zone {
		min-height: 280px;
		border: 1px dashed #aab3c5;
		border-radius: 8px;
		background: #ffffff;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
	}

	.drop-zone.dragging {
		border-color: #2563eb;
		box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
		transform: translateY(-1px);
	}

	.drop-zone.loading {
		border-color: #60a5fa;
	}

	.loading-state {
		display: flex;
		align-items: center;
		gap: 10px;
		color: #1d4ed8;
		font-size: 0.86rem;
		font-weight: 700;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid #bfdbfe;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: spin 700ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.side {
		color: #526070;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		color: #111827;
		font-size: 1.2rem;
	}

	.picker input {
		display: none;
	}

	.picker span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		background: #1f2937;
		color: #ffffff;
		cursor: pointer;
		font-weight: 700;
		min-height: 38px;
		padding: 0 14px;
	}

	p {
		color: #667085;
		margin: auto 0 0;
	}

	ul {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 0;
	}

	li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		padding: 10px 12px;
		color: #344054;
	}

	li strong {
		min-width: 84px;
		color: #111827;
		text-transform: uppercase;
	}

	.file-meta {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.artifact-summary {
		background: #f0f7ff;
		border-color: #bfdbfe;
		color: #1d4ed8;
		font-weight: 700;
	}

	.file-name {
		color: #111827;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-path {
		color: #667085;
		font-size: 0.78rem;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.exporter {
		color: #475467;
		font-size: 0.78rem;
		font-weight: 700;
	}
</style>
