<script lang="ts">
	import {
		compareGerberFiles,
		gerberLayerLabel,
		normalizeGerberLines,
		parseGerberGeometry,
		type GerberBounds,
		type GerberFile
	} from '$lib/diff/fabrication/gerberDiff';
	import { compareOdbPackages, hasUsableOdbPackage } from '$lib/diff/fabrication/odbDiff';
	import {
		type OdbBounds,
		type OdbComponentPlacement,
		type OdbLayerPreview,
		type OdbLayerType,
		type OdbPackageFile
	} from '$lib/domain/fabrication/files';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';

	let {
		files = projectStore.gerberA,
		odbPackages = projectStore.odbA
	}: { files?: GerberFile[]; odbPackages?: OdbPackageFile[] } = $props();

	let selectedKey = $state('');
	let selectedOdbLayerKey = $state('');
	type OdbViewLayer = {
		key: string;
		packageName: string;
		layer: string;
		type: OdbLayerType;
		featureCount: number;
		primitives: {
			pads: number;
			lines: number;
			arcs: number;
			surfaces: number;
			texts: number;
			other: number;
		};
		preview: OdbLayerPreview | null;
	};
	const odbLayerTypeLabels: Record<OdbLayerType, string> = {
		copper: 'Copper',
		mask: 'Mask',
		paste: 'Paste',
		silk: 'Silk',
		drill: 'Drill',
		outline: 'Outline',
		mechanical: 'Mechanical',
		document: 'Document',
		unknown: 'Other'
	};
	const gerberSummary = $derived(compareGerberFiles(projectStore.gerberA, projectStore.gerberB));
	const odbSummary = $derived(compareOdbPackages(projectStore.odbA, projectStore.odbB));
	const useOdbDiff = $derived(
		projectStore.mode === 'compare' &&
			hasUsableOdbPackage(projectStore.odbA) &&
			hasUsableOdbPackage(projectStore.odbB)
	);
	const odbLayerDiffByName = $derived.by(
		() => new Map(odbSummary.layers.map((layer) => [layer.name.toLowerCase(), layer]))
	);
	const activeFiles = $derived(files.length > 0 ? files : projectStore.gerberA);
	const odbLayers = $derived.by(() =>
		odbPackages.flatMap((odb) =>
			(odb.summary?.layers ?? []).map((layer) => ({
				key: `${odb.name.toLowerCase()}::${layer}`,
				packageName: odb.name,
				layer,
				type: odb.summary?.layerTypes[layer] ?? 'unknown',
				featureCount: odb.summary?.layerFeatureCounts[layer] ?? 0,
				primitives: odb.summary?.layerPrimitiveCounts[layer] ?? {
					pads: 0,
					lines: 0,
					arcs: 0,
					surfaces: 0,
					texts: 0,
					other: 0
				},
				preview: odb.summary?.layerPreviews[layer] ?? null
			}))
		)
	);
	const boardLayerTypes = new Set<OdbLayerType>(['copper', 'outline', 'drill']);
	const signalLayerRank = (layer: OdbViewLayer) => {
		const name = layer.layer.toLowerCase();
		if (/(^|[_\-.+])top($|[_\-.+])/.test(name)) return 0;
		if (/(^|[_\-.+])(bottom|bot)($|[_\-.+])/.test(name)) return 90;
		if (layer.type === 'copper') return 30;
		if (layer.type === 'outline') return 100;
		if (layer.type === 'drill') return 110;
		return 120;
	};
	const boardLayers = $derived.by(() =>
		odbLayers
			.filter(
				(layer) =>
					boardLayerTypes.has(layer.type) &&
					layer.preview?.bounds &&
					layer.preview.primitives.length > 0
			)
			.sort(
				(left, right) =>
					signalLayerRank(left) - signalLayerRank(right) ||
					left.layer.localeCompare(right.layer, undefined, { numeric: true })
			)
	);
	const visibleOdbLayers = $derived.by(() =>
		viewerStore.minimalUi
			? boardLayers
			: odbLayers
					.filter((layer) => layer.preview?.bounds && layer.preview.primitives.length > 0)
					.sort(
						(left, right) =>
							signalLayerRank(left) - signalLayerRank(right) ||
							left.layer.localeCompare(right.layer, undefined, { numeric: true })
					)
	);
	const odbPlacements = $derived.by(() =>
		odbPackages
			.flatMap((odb) => odb.summary?.placements ?? [])
			.filter((placement) => {
				return placement.x !== undefined && placement.y !== undefined;
			})
	);
	const boardBounds = $derived.by(() => {
		const bounds = boardLayers
			.map((layer) => layer.preview?.bounds ?? null)
			.filter((bounds): bounds is OdbBounds => !!bounds)
			.reduce<OdbBounds | null>((current, bounds) => {
				if (!current) return bounds;
				return {
					minX: Math.min(current.minX, bounds.minX),
					minY: Math.min(current.minY, bounds.minY),
					maxX: Math.max(current.maxX, bounds.maxX),
					maxY: Math.max(current.maxY, bounds.maxY)
				};
			}, null);
		return odbPlacements.reduce<OdbBounds | null>((current, placement) => {
			if (placement.x === undefined || placement.y === undefined) return current;
			if (!current)
				return {
					minX: placement.x,
					minY: placement.y,
					maxX: placement.x,
					maxY: placement.y
				};
			return {
				minX: Math.min(current.minX, placement.x),
				minY: Math.min(current.minY, placement.y),
				maxX: Math.max(current.maxX, placement.x),
				maxY: Math.max(current.maxY, placement.y)
			};
		}, bounds);
	});
	const selectedFile = $derived.by(() => {
		if (activeFiles.length === 0 || selectedKey.startsWith('__odb')) return null;
		return (
			activeFiles.find((file) => file.name.toLowerCase() === selectedKey.toLowerCase()) ??
			activeFiles[0]
		);
	});
	const selectedOdbLayer = $derived(
		visibleOdbLayers.find((layer) => layer.key === selectedOdbLayerKey) ??
			visibleOdbLayers[0] ??
			null
	);
	const selectedOdbLayerDiff = $derived(
		selectedOdbLayer ? (odbLayerDiffByName.get(selectedOdbLayer.layer.toLowerCase()) ?? null) : null
	);
	const selectedLines = $derived(selectedFile ? normalizeGerberLines(selectedFile.text) : []);
	const selectedGeometry = $derived(selectedFile ? parseGerberGeometry(selectedFile.text) : null);

	function gerberViewBox(bounds: GerberBounds) {
		const width = Math.max(1, bounds.maxX - bounds.minX);
		const height = Math.max(1, bounds.maxY - bounds.minY);
		const padding = Math.max(width, height) * 0.04 || 1;
		return `${bounds.minX - padding} ${-bounds.maxY - padding} ${width + padding * 2} ${height + padding * 2}`;
	}

	function odbViewBox(bounds: OdbBounds) {
		const width = Math.max(1, bounds.maxX - bounds.minX);
		const height = Math.max(1, bounds.maxY - bounds.minY);
		const padding = Math.max(width, height) * 0.05 || 1;
		return `${bounds.minX - padding} ${-bounds.maxY - padding} ${width + padding * 2} ${height + padding * 2}`;
	}

	function odbPolygonPoints(preview: OdbLayerPreview, points: Array<{ x: number; y: number }>) {
		const bounds = preview.bounds;
		const width = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) : 1;
		const tolerance = Math.max(width * 0.002, 0.001);
		const closed =
			points.length > 2 &&
			Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < tolerance;
		const rendered = closed ? points : [...points, points[0]];
		return rendered.map((point) => `${point.x},${point.y}`).join(' ');
	}

	function odbPointRadius(preview: OdbLayerPreview) {
		const bounds = preview.bounds;
		if (!bounds) return 0.35;
		return Math.max(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.002, 0.08);
	}

	function odbPreviewClass(type: OdbLayerType) {
		return `odb-preview odb-preview-${type}`;
	}

	function componentSize(bounds: OdbBounds | null) {
		if (!bounds) return { width: 1.4, height: 0.9 };
		const base = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
		return {
			width: Math.max(base * 0.012, 1.1),
			height: Math.max(base * 0.008, 0.7)
		};
	}

	function placementTransform(placement: OdbComponentPlacement, bounds: OdbBounds | null) {
		const size = componentSize(bounds);
		const rotation = placement.rotation ?? 0;
		return `translate(${placement.x ?? 0} ${placement.y ?? 0}) rotate(${rotation}) translate(${-size.width / 2} ${-size.height / 2})`;
	}

	$effect(() => {
		if (boardLayers.length > 0 && (!selectedKey || selectedKey === '__odb__'))
			selectedKey = '__odb_board__';
		else if (activeFiles.length === 0 && !selectedKey.startsWith('__odb')) selectedKey = '';
		else if (selectedKey.startsWith('__odb')) return;
		else if (!selectedKey && selectedFile) selectedKey = selectedFile.name;
	});

	$effect(() => {
		if (visibleOdbLayers.length === 0) selectedOdbLayerKey = '';
		else if (
			!selectedOdbLayerKey ||
			!visibleOdbLayers.some((layer) => layer.key === selectedOdbLayerKey)
		)
			selectedOdbLayerKey = visibleOdbLayers[0].key;
	});
</script>

<section class="fabrication-viewer">
	<aside>
		<header>
			<strong>Fabrication</strong>
			<span>{boardLayers.length || activeFiles.length} visual layers</span>
		</header>
		{#if boardLayers.length > 0}
			<div class="layer-list board-list">
				<h3>PCB</h3>
				<button
					class:selected={selectedKey === '__odb_board__'}
					onclick={() => (selectedKey = '__odb_board__')}
				>
					<strong><i class="layer-swatch layer-swatch-board"></i>Board view</strong>
					<span>signals, outline, drill, components</span>
					<small>{odbPlacements.length} components</small>
				</button>
			</div>
		{/if}
		{#if visibleOdbLayers.length > 0}
			<div class="layer-list odb-layer-list">
				<h3>{viewerStore.minimalUi ? 'Signal layers' : 'ODB++ layers'}</h3>
				{#each visibleOdbLayers as layer}
					<button
						class:selected={selectedOdbLayer?.key === layer.key && selectedKey === '__odb_layer__'}
						class={`odb-layer-button ${useOdbDiff ? (odbLayerDiffByName.get(layer.layer.toLowerCase())?.status ?? 'unchanged') : ''}`}
						onclick={() => {
							selectedKey = '__odb_layer__';
							selectedOdbLayerKey = layer.key;
						}}
					>
						<strong><i class={`layer-swatch layer-swatch-${layer.type}`}></i>{layer.layer}</strong>
						<span>{odbLayerTypeLabels[layer.type]}</span>
						<small>
							{#if useOdbDiff}
								{odbLayerDiffByName.get(layer.layer.toLowerCase())?.status ?? 'unchanged'}
							{:else}
								{layer.preview?.primitives.length ?? 0} items
							{/if}
						</small>
					</button>
				{/each}
			</div>
		{/if}
		<div class="layer-list" class:advanced-only={viewerStore.minimalUi && boardLayers.length > 0}>
			{#if activeFiles.length > 0}<h3>Gerber / Drill fallback</h3>{/if}
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
			{#if activeFiles.length === 0 && boardLayers.length === 0}
				<p>No Gerber file loaded.</p>
			{/if}
		</div>
	</aside>

	<div class="gerber-main">
		{#if useOdbDiff}
			<div class="diff-summary odb-diff-summary">
				<span>{odbSummary.counts.unchanged} unchanged</span>
				<span class="added">{odbSummary.counts.added} added</span>
				<span class="modified">{odbSummary.counts.modified} modified</span>
				<span class="removed">{odbSummary.counts.removed} removed</span>
				<span>ODB++ structural diff</span>
			</div>
		{:else if projectStore.mode === 'compare' && (projectStore.gerberA.length > 0 || projectStore.gerberB.length > 0)}
			<div class="diff-summary">
				<span>{gerberSummary.counts.unchanged} unchanged</span>
				<span class="added">{gerberSummary.counts.added} added</span>
				<span class="modified">{gerberSummary.counts.modified} modified</span>
				<span class="removed">{gerberSummary.counts.removed} removed</span>
				<span>Gerber fallback diff</span>
			</div>
		{/if}
		{#if !viewerStore.minimalUi && odbPackages.length > 0}
			<div class="odb-summary">
				<strong>ODB++ debug summary</strong>
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
						{@const primitiveSummary = Object.entries(summary.layerPrimitiveCounts)
							.filter(
								([, counts]) =>
									counts.pads +
										counts.lines +
										counts.arcs +
										counts.surfaces +
										counts.texts +
										counts.other >
									0
							)
							.slice(0, 8)}
						{#if primitiveSummary.length > 0}
							<div class="odb-primitives">
								{#each primitiveSummary as [layer, counts]}
									<span>
										<b>{layer}</b>
										{counts.pads}P / {counts.lines}L / {counts.arcs}A / {counts.surfaces}S
									</span>
								{/each}
							</div>
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
		{#if selectedKey === '__odb_board__' && boardBounds}
			<header class="file-header">
				<div>
					<strong>ODB++ PCB</strong>
					<span>signals, outline, drill and placed components</span>
				</div>
				<b>{boardLayers.length} layers / {odbPlacements.length} components</b>
			</header>
			<div class="odb-layer-details">
				<div class="odb-preview odb-board-preview">
					<svg viewBox={odbViewBox(boardBounds)} aria-label="ODB++ board preview">
						<g transform="scale(1 -1)">
							{#each boardLayers as layer}
								{@const preview = layer.preview}
								{#if preview}
									<g class={`board-layer board-layer-${layer.type}`}>
										{#each preview.primitives as primitive}
											{#if primitive.type === 'line'}
												<line
													x1={primitive.from.x}
													y1={primitive.from.y}
													x2={primitive.to.x}
													y2={primitive.to.y}
												/>
											{:else if primitive.type === 'polygon'}
												<polygon points={odbPolygonPoints(preview, primitive.points)} />
											{:else}
												<circle
													cx={primitive.at.x}
													cy={primitive.at.y}
													r={odbPointRadius(preview)}
												/>
											{/if}
										{/each}
									</g>
								{/if}
							{/each}
							<g class="component-layer">
								{#each odbPlacements as placement}
									{@const size = componentSize(boardBounds)}
									<g transform={placementTransform(placement, boardBounds)}>
										<rect width={size.width} height={size.height} />
										<title>{placement.designator}</title>
									</g>
								{/each}
							</g>
						</g>
					</svg>
					<div class="preview-status">
						<span
							>{boardLayers.filter((layer) => layer.type === 'copper').length} signal layers</span
						>
						<span
							>{boardLayers.some((layer) => layer.type === 'outline')
								? 'outline'
								: 'no outline'}</span
						>
						<span>{odbPlacements.length} components</span>
					</div>
				</div>
				<footer class="odb-layer-stats">
					<span><b>{boardLayers.filter((layer) => layer.type === 'copper').length}</b> signal</span>
					<span><b>{boardLayers.filter((layer) => layer.type === 'drill').length}</b> drill</span>
					<span
						><b>{boardLayers.filter((layer) => layer.type === 'outline').length}</b> outline</span
					>
					<span><b>{odbPlacements.length}</b> components</span>
				</footer>
			</div>
		{:else if selectedFile}
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
		{:else if selectedOdbLayer}
			<header class="file-header">
				<div>
					<strong>{selectedOdbLayer.layer}</strong>
					<span>{selectedOdbLayer.packageName} / {selectedOdbLayer.type}</span>
				</div>
				<b>{selectedOdbLayer.featureCount} features</b>
			</header>
			<div class="odb-layer-details">
				{#if selectedOdbLayer.preview?.bounds && selectedOdbLayer.preview.primitives.length > 0}
					<div class={odbPreviewClass(selectedOdbLayer.type)}>
						<svg
							viewBox={odbViewBox(selectedOdbLayer.preview.bounds)}
							aria-label={`ODB++ ${selectedOdbLayer.layer} layer preview`}
						>
							<g transform="scale(1 -1)">
								{#each selectedOdbLayer.preview.primitives as primitive}
									{#if primitive.type === 'line'}
										<line
											x1={primitive.from.x}
											y1={primitive.from.y}
											x2={primitive.to.x}
											y2={primitive.to.y}
										/>
									{:else if primitive.type === 'polygon'}
										<polygon
											points={odbPolygonPoints(selectedOdbLayer.preview, primitive.points)}
										/>
									{:else}
										<circle
											cx={primitive.at.x}
											cy={primitive.at.y}
											r={odbPointRadius(selectedOdbLayer.preview)}
										/>
									{/if}
								{/each}
							</g>
						</svg>
						<div class="preview-status">
							<span>{selectedOdbLayer.preview.primitives.length} visual primitives</span>
							<span>{odbLayerTypeLabels[selectedOdbLayer.type]}</span>
							{#if selectedOdbLayer.preview.truncated}
								<span>preview truncated</span>
							{/if}
						</div>
					</div>
				{:else}
					<div class="empty">
						<strong>No visual geometry extracted</strong>
						<span>This layer has feature records, but not enough coordinates for preview yet.</span>
					</div>
				{/if}
				<footer class="odb-layer-stats">
					<span><b>{selectedOdbLayer.primitives.pads}</b> pads</span>
					<span><b>{selectedOdbLayer.primitives.lines}</b> lines</span>
					<span><b>{selectedOdbLayer.primitives.arcs}</b> arcs</span>
					<span><b>{selectedOdbLayer.primitives.surfaces}</b> surfaces</span>
					<span><b>{selectedOdbLayer.primitives.texts}</b> texts</span>
					<span><b>{selectedOdbLayer.primitives.other}</b> other</span>
					{#if useOdbDiff && selectedOdbLayerDiff}
						<span class={`diff-chip ${selectedOdbLayerDiff.status}`}>
							<b>{selectedOdbLayerDiff.visualCounts.added}</b> added
						</span>
						<span class={`diff-chip ${selectedOdbLayerDiff.status}`}>
							<b>{selectedOdbLayerDiff.visualCounts.removed}</b> removed
						</span>
						<span class="diff-chip unchanged">
							<b>{selectedOdbLayerDiff.visualCounts.unchanged}</b> common
						</span>
					{/if}
				</footer>
			</div>
		{:else if odbPackages.length > 0}
			<div class="empty">
				<strong>ODB++ package loaded</strong>
				<span
					>The package is tracked, but no layer feature data was extracted from this archive.</span
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

	.layer-list {
		flex: 1;
		overflow: auto;
		padding: 8px;
	}

	.board-list {
		flex: 0 0 auto;
		border-bottom: 1px solid #eef2f6;
	}

	.odb-layer-list {
		flex: 1 1 auto;
		border-bottom: 1px solid #eef2f6;
	}

	h3 {
		margin: 4px 4px 8px;
		color: #64748b;
		font-size: 0.68rem;
		text-transform: uppercase;
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

	.layer-list button strong {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}

	.layer-swatch {
		flex: 0 0 auto;
		width: 10px;
		height: 10px;
		border: 1px solid rgba(15, 23, 42, 0.18);
		border-radius: 50%;
		background: #64748b;
	}

	.layer-swatch-copper {
		background: #2563eb;
	}

	.layer-swatch-board {
		background: linear-gradient(135deg, #2563eb 0 45%, #0f172a 45% 58%, #16a34a 58%);
	}

	.layer-swatch-mask {
		background: #16a34a;
	}

	.layer-swatch-paste {
		background: #64748b;
	}

	.layer-swatch-silk {
		background: #7c3aed;
	}

	.layer-swatch-drill {
		background: #dc2626;
	}

	.layer-swatch-outline,
	.layer-swatch-mechanical {
		background: #0f172a;
	}

	.layer-swatch-document,
	.layer-swatch-unknown {
		background: #c2410c;
	}

	.layer-list button:hover,
	.layer-list button.selected {
		border-color: #bfdbfe;
		background: #eff6ff;
	}

	.odb-layer-button.added {
		border-color: #86efac;
		background: #f0fdf4;
	}

	.odb-layer-button.modified {
		border-color: #fed7aa;
		background: #fff7ed;
	}

	.odb-layer-button.removed {
		border-color: #fecaca;
		background: #fef2f2;
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

	.advanced-only {
		display: none;
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

	.odb-diff-summary {
		border-bottom-color: #bbf7d0;
		background: #f0fdf4;
	}

	.file-header b {
		color: #475569;
		font-size: 0.76rem;
	}

	.odb-layer-details {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		gap: 0;
		min-height: 0;
		overflow: hidden;
		background:
			linear-gradient(#eef2f6 1px, transparent 1px),
			linear-gradient(90deg, #eef2f6 1px, transparent 1px), #f8fafc;
		background-size: 28px 28px;
	}

	.odb-preview {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	.odb-preview svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.odb-preview line {
		fill: none;
		stroke: var(--odb-stroke, #1d4ed8);
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 0.12;
	}

	.odb-preview polygon {
		fill: var(--odb-fill, rgba(37, 99, 235, 0.22));
		stroke: var(--odb-stroke, #1d4ed8);
		stroke-linejoin: round;
		stroke-width: 0.12;
	}

	.odb-preview circle {
		fill: var(--odb-stroke, #1d4ed8);
		stroke: #ffffff;
		stroke-width: 0.08;
		vector-effect: non-scaling-stroke;
	}

	.odb-board-preview {
		background:
			linear-gradient(#e2e8f0 1px, transparent 1px),
			linear-gradient(90deg, #e2e8f0 1px, transparent 1px), #f8fafc;
		background-size: 24px 24px;
	}

	.board-layer {
		opacity: 0.72;
	}

	.board-layer line {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 0.13;
		vector-effect: non-scaling-stroke;
	}

	.board-layer polygon {
		stroke-linejoin: round;
		stroke-width: 0.09;
		vector-effect: non-scaling-stroke;
	}

	.board-layer circle {
		stroke: rgba(255, 255, 255, 0.85);
		stroke-width: 0.06;
		vector-effect: non-scaling-stroke;
	}

	.board-layer-copper line,
	.board-layer-copper polygon,
	.board-layer-copper circle {
		fill: rgba(37, 99, 235, 0.2);
		stroke: #2563eb;
	}

	.board-layer-outline {
		opacity: 1;
	}

	.board-layer-outline line,
	.board-layer-outline polygon,
	.board-layer-outline circle {
		fill: rgba(15, 23, 42, 0.04);
		stroke: #0f172a;
		stroke-width: 0.2;
	}

	.board-layer-drill line,
	.board-layer-drill polygon,
	.board-layer-drill circle {
		fill: rgba(220, 38, 38, 0.34);
		stroke: #dc2626;
	}

	.component-layer rect {
		fill: rgba(245, 158, 11, 0.45);
		stroke: #92400e;
		stroke-width: 0.08;
		vector-effect: non-scaling-stroke;
	}

	.odb-preview-copper {
		--odb-stroke: #2563eb;
		--odb-fill: rgba(37, 99, 235, 0.24);
	}

	.odb-preview-mask {
		--odb-stroke: #16a34a;
		--odb-fill: rgba(22, 163, 74, 0.22);
	}

	.odb-preview-paste {
		--odb-stroke: #64748b;
		--odb-fill: rgba(100, 116, 139, 0.22);
	}

	.odb-preview-silk {
		--odb-stroke: #7c3aed;
		--odb-fill: rgba(124, 58, 237, 0.18);
	}

	.odb-preview-drill {
		--odb-stroke: #dc2626;
		--odb-fill: rgba(220, 38, 38, 0.18);
	}

	.odb-preview-outline,
	.odb-preview-mechanical {
		--odb-stroke: #0f172a;
		--odb-fill: rgba(15, 23, 42, 0.1);
	}

	.odb-preview-document,
	.odb-preview-unknown {
		--odb-stroke: #c2410c;
		--odb-fill: rgba(194, 65, 12, 0.16);
	}

	.odb-layer-stats {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		border-top: 1px solid #dbe2ec;
		background: rgba(255, 255, 255, 0.94);
		padding: 8px 12px;
	}

	.odb-layer-stats span {
		border: 1px solid #dbe2ec;
		border-radius: 6px;
		background: #ffffff;
		color: #475569;
		padding: 5px 8px;
		font-size: 0.76rem;
		font-weight: 800;
	}

	.odb-layer-stats b {
		color: #1d4ed8;
	}

	.odb-layer-stats .diff-chip.added b {
		color: #15803d;
	}

	.odb-layer-stats .diff-chip.modified b {
		color: #c2410c;
	}

	.odb-layer-stats .diff-chip.removed b {
		color: #b91c1c;
	}

	.odb-layer-stats .diff-chip.unchanged b {
		color: #475569;
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

	.odb-primitives {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 6px;
	}

	.odb-primitives span {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		border: 1px solid #c7d2fe;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.75);
		color: #475569;
		padding: 5px 7px;
		font-size: 0.68rem;
		font-weight: 800;
	}

	.odb-primitives b {
		color: #1e3a8a;
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
