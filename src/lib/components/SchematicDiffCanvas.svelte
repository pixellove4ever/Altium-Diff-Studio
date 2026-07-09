<script lang="ts">
	import DxfSchematicViewer from '$lib/components/DxfSchematicViewer.svelte';
	import FaithfulSchematicCanvas from '$lib/components/FaithfulSchematicCanvas.svelte';
	import LogicalSchematicCanvas from '$lib/components/LogicalSchematicCanvas.svelte';
	import SmartPdfViewer from '$lib/components/SmartPdfViewer.svelte';
	import {
		diffColors,
		getNetLabelDiff,
		getSchematicComponentDiff,
		getWireDiff,
		type DiffStatus
	} from '$lib/diff/altiumDiff';
	import { resolveDxfTextLink } from '$lib/domain/dxfLinker';
	import { buildPowerGraph } from '$lib/domain/powerGraph';
	import { prepareSchematicRenderGeometry } from '$lib/domain/schematicRenderGeometry';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { importStore } from '$lib/state/importStore.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';
	import type { AltiumSchMarker, AltiumSchematicDoc } from '$lib/types/altium';

	const schematicA = $derived(projectStore.projectA.schematic);
	const schematicB = $derived(
		projectStore.mode === 'view' ? projectStore.projectA.schematic : projectStore.projectB.schematic
	);
	let selectedSheetIndex = $state(0);
	let selectedChannel = $state('');
	let renderMode = $state<'logical' | 'sheet' | 'dxf' | 'pdf'>('logical');
	let logicalVersion = $state<'before' | 'changes' | 'after'>('changes');
	let dxfView = $state<'compare' | 'slider' | 'a' | 'b'>('compare');
	let dxfSyncZoom = $state(1);
	let dxfSyncPanX = $state(0);
	let dxfSyncPanY = $state(0);
	let dxfSliderPosition = $state(0.5);
	let dxfSliderDragging = $state(false);
	let dxfSliderContainer = $state<HTMLDivElement | null>(null);
	let diffFilter = $state<'all' | Exclude<DiffStatus, 'unchanged'>>('all');
	let dxfAutoActivated = $state(false);
	const smartPdf = $derived(
		projectStore.mode === 'view' ? projectStore.pdfA : (projectStore.pdfB ?? projectStore.pdfA)
	);
	const schematicDxfsA = $derived(projectStore.dxfA);
	const schematicDxfsB = $derived(
		projectStore.mode === 'view' ? projectStore.dxfA : projectStore.dxfB
	);
	const schematicDxfs = $derived(
		projectStore.mode === 'view'
			? schematicDxfsA
			: schematicDxfsB.length > 0
				? schematicDxfsB
				: schematicDxfsA
	);
	const sheetOptions = $derived.by(() => {
		const maxLength = Math.max(
			schematicA?.sheets.length ?? 0,
			schematicB?.sheets.length ?? 0,
			schematicDxfsA.length,
			schematicDxfsB.length
		);
		return Array.from({ length: maxLength }, (_, index) => {
			const sheetA = schematicA?.sheets[index];
			const sheetB = schematicB?.sheets[index];
			return {
				index,
				label:
					sheetA?.name ||
					sheetA?.fileName ||
					sheetB?.name ||
					sheetB?.fileName ||
					schematicDxfs[index]?.name.replace(/\.dxf$/i, '') ||
					`Sheet ${index + 1}`
			};
		});
	});
	const selectedA = $derived(sliceSchematic(schematicA, selectedSheetIndex));
	const selectedB = $derived(sliceSchematic(schematicB, selectedSheetIndex));
	const componentDiff = $derived(getSchematicComponentDiff(selectedA, selectedB));
	const wireDiff = $derived(getWireDiff(selectedA, selectedB));
	const netLabelDiff = $derived(getNetLabelDiff(selectedA, selectedB));
	const visibleComponentDiff = $derived(
		componentDiff.filter(
			(item) => item.status !== 'unchanged' && (diffFilter === 'all' || item.status === diffFilter)
		)
	);
	const diffCounts = $derived({
		added: componentDiff.filter((item) => item.status === 'added').length,
		removed: componentDiff.filter((item) => item.status === 'removed').length,
		modified: componentDiff.filter((item) => item.status === 'modified').length
	});
	const selectedComponentDiff = $derived.by(() => {
		const selected = projectStore.selectedDesignator?.replace(/_[A-Za-z]+\d+$/, '').toUpperCase();
		return selected
			? (componentDiff.find((item) => item.designator.toUpperCase() === selected) ?? null)
			: null;
	});
	const selectedBeforeRecord = $derived(
		selectedComponentDiff
			? (projectStore.indexA.byDesignator.get(selectedComponentDiff.designator.toUpperCase()) ??
					null)
			: null
	);
	const selectedAfterRecord = $derived(
		selectedComponentDiff
			? (projectStore.indexB.byDesignator.get(selectedComponentDiff.designator.toUpperCase()) ??
					null)
			: null
	);
	const selectedDiffFields = $derived.by(() => {
		const before = selectedComponentDiff?.before;
		const after = selectedComponentDiff?.after;
		if (!selectedComponentDiff) return [];
		const rows = [
			{
				label: 'Value',
				before: before?.value || before?.comment || '',
				after: after?.value || after?.comment || ''
			},
			{ label: 'Library', before: before?.libRef ?? '', after: after?.libRef ?? '' },
			{
				label: 'Footprint',
				before: selectedBeforeRecord?.bom?.footprint || selectedBeforeRecord?.pcb?.footprint || '',
				after: selectedAfterRecord?.bom?.footprint || selectedAfterRecord?.pcb?.footprint || ''
			},
			{
				label: 'Nets',
				before: selectedBeforeRecord?.nets.join(', ') ?? '',
				after: selectedAfterRecord?.nets.join(', ') ?? ''
			}
		];
		return rows.filter(
			(row) => row.before !== row.after || selectedComponentDiff.status !== 'modified'
		);
	});
	const selectedPinDiffs = $derived.by(() => {
		const before = new Map(
			(selectedBeforeRecord?.pinConnections ?? []).map((pin) => [pin.pinNumber, pin])
		);
		const after = new Map(
			(selectedAfterRecord?.pinConnections ?? []).map((pin) => [pin.pinNumber, pin])
		);
		const numbers = new Set([...before.keys(), ...after.keys()]);
		return Array.from(numbers)
			.map((number) => {
				const oldPin = before.get(number);
				const newPin = after.get(number);
				return {
					number,
					name: newPin?.pinName || oldPin?.pinName || '',
					before: oldPin?.net || '',
					after: newPin?.net || '',
					status: !oldPin
						? 'added'
						: !newPin
							? 'removed'
							: oldPin.net !== newPin.net
								? 'modified'
								: 'unchanged'
				};
			})
			.filter((pin) => pin.status !== 'unchanged')
			.sort((left, right) => left.number.localeCompare(right.number, undefined, { numeric: true }));
	});
	const visibleWireDiff = $derived(wireDiff.filter((item) => item.status !== 'unchanged'));
	const visibleNetLabelDiff = $derived(netLabelDiff.filter((item) => item.status !== 'unchanged'));
	const selectedSheet = $derived(selectedB?.sheets[0] ?? selectedA?.sheets[0]);
	const displayedLogicalSheet = $derived(
		projectStore.mode === 'compare' && logicalVersion === 'before'
			? selectedA?.sheets[0]
			: (selectedB?.sheets[0] ?? selectedA?.sheets[0])
	);
	const displayedSheetGeometry = $derived(
		displayedLogicalSheet ? prepareSchematicRenderGeometry(displayedLogicalSheet) : null
	);
	const hasFaithfulSheet = $derived(displayedSheetGeometry?.hasFaithfulGeometry ?? false);
	function resolveSelectedDxf(files: typeof schematicDxfsA, sheet: typeof selectedSheet) {
		if (files.length === 0) return null;
		if (!sheet) return files[selectedSheetIndex] ?? files[0];
		const keys = [sheet.name, sheet.fileName, sheet.path]
			.filter((value): value is string => !!value)
			.map(normalizeArtifactName)
			.filter(Boolean);
		const scored = files
			.map((file, index) => {
				const stem = normalizeArtifactName(file.name);
				const score = Math.max(
					0,
					...keys.map((key) =>
						stem === key ? 100 : stem.includes(key) || key.includes(stem) ? 60 : 0
					)
				);
				return { file, index, score };
			})
			.sort((left, right) => right.score - left.score || left.index - right.index);
		return scored[0]?.score > 0 ? scored[0].file : (files[selectedSheetIndex] ?? files[0]);
	}
	const selectedDxfA = $derived(resolveSelectedDxf(schematicDxfsA, selectedA?.sheets[0]));
	const selectedDxfB = $derived(resolveSelectedDxf(schematicDxfsB, selectedB?.sheets[0]));
	const selectedDxf = $derived(selectedDxfB ?? selectedDxfA);
	const powerGraph = $derived(
		buildPowerGraph(projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB)
	);
	const channelOptions = $derived.by(() => {
		const target = selectedSheet;
		if (!target) return [];
		const targetNames = [target.fileName, target.name, target.path].filter(Boolean).map((value) =>
			(value as string)
				.replace(/^.*[\\/]/, '')
				.replace(/\.SchDoc$/i, '')
				.toUpperCase()
		);
		const result: string[] = [];
		const matchingSymbols: AltiumSchMarker[] = [];
		for (const sheet of (schematicB ?? schematicA)?.sheets ?? []) {
			for (const symbol of sheet.sheetSymbols ?? []) {
				const child = (symbol.fileName ?? '')
					.replace(/^.*[\\/]/, '')
					.replace(/\.SchDoc$/i, '')
					.toUpperCase();
				if (!child || !targetNames.includes(child)) continue;
				matchingSymbols.push(symbol);
				const name = symbol.name?.trim() ?? '';
				const repeat = name.match(/^Repeat\(\s*([^,]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
				if (repeat) {
					for (let index = Number(repeat[2]); index <= Number(repeat[3]); index += 1) {
						result.push(`${repeat[1]}${index}`);
					}
				}
			}
		}
		if (result.length === 0 && matchingSymbols.length > 1) {
			for (const symbol of matchingSymbols) {
				const name = symbol.name?.trim();
				if (name) result.push(name);
			}
		}
		return Array.from(new Set(result));
	});

	$effect(() => {
		if (selectedSheetIndex >= sheetOptions.length)
			selectedSheetIndex = Math.max(0, sheetOptions.length - 1);
	});

	$effect(() => {
		selectedSheetIndex;
		dxfSyncZoom = 1;
		dxfSyncPanX = 0;
		dxfSyncPanY = 0;
	});

	$effect(() => {
		if (selectedDxf && !dxfAutoActivated) {
			renderMode = 'dxf';
			dxfAutoActivated = true;
		}
		if (!selectedDxf) dxfAutoActivated = false;
	});

	$effect(() => {
		if (projectStore.mode !== 'compare') return;
		if (selectedDxfA && selectedDxfB) return;
		dxfView = selectedDxfB ? 'b' : 'a';
	});

	$effect(() => {
		if (channelOptions.length === 0) selectedChannel = '';
		else if (!channelOptions.includes(selectedChannel)) selectedChannel = channelOptions[0];
	});

	$effect(() => {
		const selected = projectStore.selectedDesignator;
		if (!selected) return;
		const channelMatch = selected.match(/_([A-Za-z]+\d+)$/);
		const designator = selected.replace(/_[A-Za-z]+\d+$/, '').toLowerCase();
		const candidateSheets = schematicB?.sheets ?? [];
		let sheetIndex = candidateSheets.findIndex((sheet) =>
			sheet.components.some((component) => component.designator.toLowerCase() === designator)
		);
		if (sheetIndex < 0) {
			sheetIndex =
				schematicA?.sheets.findIndex((sheet) =>
					sheet.components.some((component) => component.designator.toLowerCase() === designator)
				) ?? -1;
		}
		if (sheetIndex >= 0) {
			selectedSheetIndex = sheetIndex;
			if (channelMatch) selectedChannel = channelMatch[1];
		}
	});

	function instanceDesignator(designator: string) {
		return selectedChannel ? `${designator}_${selectedChannel}` : designator;
	}

	function selectSheet(index: number) {
		if (sheetOptions.length === 0) {
			selectedSheetIndex = 0;
			return;
		}
		selectedSheetIndex = Math.max(0, Math.min(sheetOptions.length - 1, index));
	}

	function moveSheet(delta: number) {
		selectSheet(selectedSheetIndex + delta);
	}

	function onSchematicKeyDown(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLSelectElement ||
			event.target instanceof HTMLTextAreaElement
		)
			return;
		if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
		event.preventDefault();
		moveSheet(event.key === 'PageUp' ? -1 : 1);
	}

	function onPdfInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importStore.loadBrowserFiles(projectStore.mode === 'view' ? 'A' : 'B', [file]);
		input.value = '';
	}

	function onDxfInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (!input.files?.length) return;
		importStore.loadBrowserFiles(projectStore.mode === 'view' ? 'A' : 'B', input.files);
		input.value = '';
	}

	function selectDxfText(text: string, side: 'A' | 'B' = 'B') {
		const index =
			side === 'A' || projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB;
		const link = resolveDxfTextLink(text, index);
		if (!link) return;
		if (link.kind === 'component') projectStore.selectDesignator(link.designator);
		else projectStore.selectNet(link.net);
	}

	function dxfTextTooltip(text: string, side: 'A' | 'B' = 'B') {
		const index =
			side === 'A' || projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB;
		return resolveDxfTextLink(text, index)?.tooltip ?? null;
	}

	function normalizeArtifactName(value: string) {
		return value
			.replace(/^.*[\\/]/, '')
			.replace(/\.(SchDoc|dxf)$/i, '')
			.replace(/^(.*?)[_-](schematic|schema|sch)[_-]?/i, '$1_')
			.replace(/[^a-z0-9]+/gi, '')
			.toLowerCase();
	}

	function onDxfSliderDown(event: PointerEvent) {
		event.stopPropagation();
		dxfSliderDragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onDxfSliderMove(event: PointerEvent) {
		if (!dxfSliderDragging || !dxfSliderContainer) return;
		event.stopPropagation();
		const rect = dxfSliderContainer.getBoundingClientRect();
		dxfSliderPosition = Math.max(0.02, Math.min(0.98, (event.clientX - rect.left) / rect.width));
	}

	function onDxfSliderUp(event: PointerEvent) {
		dxfSliderDragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	}

	function onDxfSliderKeyDown(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		dxfSliderPosition = Math.max(
			0.02,
			Math.min(0.98, dxfSliderPosition + (event.key === 'ArrowLeft' ? -0.02 : 0.02))
		);
	}

	function sliceSchematic(
		doc: AltiumSchematicDoc | null,
		index: number
	): AltiumSchematicDoc | null {
		const sheet = doc?.sheets[index];
		if (!doc || !sheet) return null;
		return { ...doc, sheets: [sheet] };
	}
</script>

<svelte:window onkeydown={onSchematicKeyDown} />

<div
	class="schematic-view"
	class:minimal={viewerStore.minimalUi}
	role="region"
	aria-label="Schematic viewer"
>
	<aside class="diff-panel">
		<div class="page-control">
			{#if !viewerStore.minimalUi}
				<div class="view-switch" aria-label={localeStore.t('schematic.representation')}>
					<button class:active={renderMode === 'logical'} onclick={() => (renderMode = 'logical')}>
						{localeStore.t('schematic.logical')}
					</button>
					<button
						class:active={renderMode === 'sheet'}
						disabled={!hasFaithfulSheet}
						title={hasFaithfulSheet
							? localeStore.t('schematic.sheetNative')
							: localeStore.t('schematic.sheetNativeHint')}
						onclick={() => (renderMode = 'sheet')}
					>
						{localeStore.t('schematic.sheetNative')}
					</button>
					<button
						class:active={renderMode === 'dxf'}
						disabled={!selectedDxf}
						title={selectedDxf ? selectedDxf.name : localeStore.t('schematic.loadDxfHint')}
						onclick={() => (renderMode = 'dxf')}
					>
						DXF
					</button>
					<button
						class:active={renderMode === 'pdf'}
						disabled={!smartPdf}
						title={smartPdf ? smartPdf.name : localeStore.t('schematic.loadPdfHint')}
						onclick={() => (renderMode = 'pdf')}
					>
						Smart PDF
					</button>
				</div>
			{/if}
			{#if projectStore.mode === 'compare' && (renderMode === 'logical' || renderMode === 'sheet') && !viewerStore.minimalUi}
				<div class="logical-version" aria-label="Logical comparison version">
					<button
						class:active={logicalVersion === 'before'}
						onclick={() => (logicalVersion = 'before')}>{localeStore.t('schematic.before')}</button
					>
					<button
						class:active={logicalVersion === 'changes'}
						onclick={() => (logicalVersion = 'changes')}
						>{localeStore.t('schematic.changes')}</button
					>
					<button
						class:active={logicalVersion === 'after'}
						onclick={() => (logicalVersion = 'after')}>{localeStore.t('schematic.after')}</button
					>
				</div>
			{/if}
			{#if projectStore.mode === 'compare' && renderMode === 'dxf' && !viewerStore.minimalUi}
				<div class="logical-version dxf-version" aria-label="DXF comparison version">
					<button class:active={dxfView === 'a'} onclick={() => (dxfView = 'a')}>A</button>
					<button
						class:active={dxfView === 'compare'}
						disabled={!selectedDxfA || !selectedDxfB}
						onclick={() => (dxfView = 'compare')}>A | B</button
					>
					<button
						class:active={dxfView === 'slider'}
						disabled={!selectedDxfA || !selectedDxfB}
						onclick={() => (dxfView = 'slider')}>{localeStore.t('schematic.slider')}</button
					>
					<button class:active={dxfView === 'b'} onclick={() => (dxfView = 'b')}>B</button>
				</div>
			{/if}
			<div class="sheet-navigator" aria-label="Schematic sheet navigation">
				<button
					aria-label="Previous schematic sheet"
					disabled={selectedSheetIndex <= 0}
					onclick={() => moveSheet(-1)}>Prev</button
				>
				<strong>{selectedSheetIndex + 1} / {Math.max(sheetOptions.length, 1)}</strong>
				<button
					aria-label="Next schematic sheet"
					disabled={selectedSheetIndex >= sheetOptions.length - 1}
					onclick={() => moveSheet(1)}>Next</button
				>
			</div>
			{#if !viewerStore.minimalUi}
				<label class="pdf-picker">
					<input type="file" accept=".pdf,application/pdf" onchange={onPdfInput} />
					<span>{smartPdf ? `Replace Smart PDF · ${smartPdf.name}` : 'Load Altium Smart PDF'}</span>
				</label>
				<label class="pdf-picker">
					<input type="file" accept=".dxf,application/dxf" multiple onchange={onDxfInput} />
					<span>
						{schematicDxfs.length > 0
							? `${schematicDxfs.length} DXF loaded · ${selectedDxf?.name ?? 'select a page'}`
							: 'Load all schematic DXF files'}
					</span>
				</label>
			{/if}
			<label>
				{localeStore.t('schematic.page')}
				<select
					value={selectedSheetIndex}
					onchange={(event) =>
						selectSheet(Number((event.currentTarget as HTMLSelectElement).value))}
				>
					{#each sheetOptions as sheet}
						<option value={sheet.index}>{sheet.label}</option>
					{/each}
				</select>
			</label>
			{#if channelOptions.length > 0}
				<label>
					{localeStore.t('schematic.channel')}
					<select bind:value={selectedChannel}>
						{#each channelOptions as channel}
							<option value={channel}>{channel}</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>
		{#if !viewerStore.minimalUi}
			{#if projectStore.mode === 'compare'}
				<div class="legend">
					<span><i class="added"></i>{localeStore.t('schematic.added')}</span>
					<span><i class="removed"></i>{localeStore.t('schematic.removed')}</span>
					<span><i class="modified"></i>{localeStore.t('schematic.modified')}</span>
				</div>
			{/if}
			<div class="sheet-stats">
				{#if projectStore.mode === 'view'}
					<span>{selectedA?.sheets[0]?.components.length ?? 0} components</span>
					<span>{selectedA?.sheets[0]?.wires.length ?? 0} wires</span>
					<span
						>{(selectedA?.sheets[0]?.ports?.length ?? 0) +
							(selectedA?.sheets[0]?.powerPorts?.length ?? 0)} ports</span
					>
					<span
						>{selectedA?.sheets[0]?.buses?.length ?? 0} buses · {selectedA?.sheets[0]?.noERC
							?.length ?? 0} No ERC</span
					>
				{:else}
					<span
						>A: {selectedA?.sheets[0]?.components.length ?? 0} comp, {selectedA?.sheets[0]?.wires
							.length ?? 0} wires</span
					>
					<span
						>B: {selectedB?.sheets[0]?.components.length ?? 0} comp, {selectedB?.sheets[0]?.wires
							.length ?? 0} wires</span
					>
				{/if}
			</div>

			<details class="power-tree">
				<summary>Power tree ({powerGraph.rails.length} rails)</summary>
				{#if powerGraph.edges.length > 0}
					<div class="power-edges">
						{#each powerGraph.edges as edge}
							<button onclick={() => projectStore.selectNet(edge.to)}>
								<span>{edge.from} -&gt; {edge.to}</span>
								<small>{edge.component} - {edge.confidence}</small>
							</button>
						{/each}
					</div>
				{:else}
					<p>No directed converter relation detected.</p>
				{/if}
				<div class="power-rails">
					{#each powerGraph.rails as rail}
						<button onclick={() => projectStore.selectNet(rail.name)}>
							<strong>{rail.name}</strong>
							<small>{rail.components.length} components</small>
						</button>
					{/each}
				</div>
			</details>
		{/if}
		{#if !viewerStore.minimalUi}
			<div class="change-list">
				{#if projectStore.mode === 'view'}
					<h3>{localeStore.t('schematic.components')}</h3>
					{#each selectedA?.sheets[0]?.components ?? [] as component}
						<button
							class:selected={projectStore.selectedDesignator ===
								instanceDesignator(component.designator)}
							style="--status-color: #6b7280"
							onclick={() =>
								projectStore.selectDesignator(instanceDesignator(component.designator))}
						>
							<strong>{instanceDesignator(component.designator)}</strong>
							<span>{component.value || component.comment || component.libRef}</span>
						</button>
					{/each}
				{:else}
					<h3>{localeStore.t('schematic.differences')}</h3>
					<div class="diff-filters" aria-label="Filter differences">
						<button class:active={diffFilter === 'all'} onclick={() => (diffFilter = 'all')}>
							{localeStore.t('schematic.all')}
							<b>{diffCounts.added + diffCounts.removed + diffCounts.modified}</b>
						</button>
						<button
							class:active={diffFilter === 'added'}
							class="added"
							onclick={() => (diffFilter = 'added')}
						>
							+ <b>{diffCounts.added}</b>
						</button>
						<button
							class:active={diffFilter === 'modified'}
							class="modified"
							onclick={() => (diffFilter = 'modified')}
						>
							~ <b>{diffCounts.modified}</b>
						</button>
						<button
							class:active={diffFilter === 'removed'}
							class="removed"
							onclick={() => (diffFilter = 'removed')}
						>
							− <b>{diffCounts.removed}</b>
						</button>
					</div>
					{#each visibleComponentDiff as diff}
						<button
							class:selected={projectStore.selectedDesignator === diff.designator}
							style={`--status-color: ${diffColors[diff.status]}`}
							onclick={() => projectStore.selectDesignator(diff.designator)}
						>
							<strong>{diff.designator}</strong>
							<span>{diff.status}</span>
						</button>
					{/each}
					{#if visibleWireDiff.length > 0 || visibleNetLabelDiff.length > 0}
						<p>{visibleWireDiff.length} wire changes, {visibleNetLabelDiff.length} label changes</p>
					{/if}
					{#if visibleComponentDiff.length === 0 && visibleWireDiff.length === 0 && visibleNetLabelDiff.length === 0}
						<p>No schematic difference on this page.</p>
					{/if}
					{#if selectedComponentDiff}
						<section class="diff-detail">
							<header>
								<div>
									<strong>{selectedComponentDiff.designator}</strong>
									<small>{selectedComponentDiff.status}</small>
								</div>
								<span class={`status-dot ${selectedComponentDiff.status}`}></span>
							</header>
							{#if selectedDiffFields.length > 0}
								<div class="diff-columns" aria-hidden="true">
									<span>{localeStore.t('schematic.before')}</span>
									<span>{localeStore.t('schematic.after')}</span>
								</div>
								{#each selectedDiffFields as field}
									<div class:changed={field.before !== field.after} class="field-diff">
										<span class="field-label">{field.label}</span>
										<div>
											<del>{field.before || '—'}</del>
											<ins>{field.after || '—'}</ins>
										</div>
									</div>
								{/each}
							{:else}
								<p>No electrical field changed.</p>
							{/if}
							{#if selectedPinDiffs.length > 0}
								<div class="pin-diffs">
									<strong>Pin connectivity</strong>
									{#each selectedPinDiffs as pin}
										<div class={`pin-change ${pin.status}`}>
											<span>{pin.number}{pin.name ? ` · ${pin.name}` : ''}</span>
											<small>{pin.before || '∅'} → {pin.after || '∅'}</small>
										</div>
									{/each}
								</div>
							{/if}
						</section>
					{/if}
				{/if}
			</div>
		{/if}
	</aside>
	<div class="canvas-area">
		{#if renderMode === 'dxf' && projectStore.mode === 'compare' && dxfView === 'compare' && selectedDxfA && selectedDxfB}
			<div class="dxf-compare">
				<section>
					<header>A · {selectedDxfA.name}</header>
					<DxfSchematicViewer
						text={selectedDxfA.text}
						comparisonText={selectedDxfB.text}
						diffRole="before"
						name={selectedDxfA.name}
						focusText={projectStore.selectedDesignator ?? projectStore.selectedNet}
						onTextClick={(text) => selectDxfText(text, 'A')}
						resolveTextTooltip={(text) => dxfTextTooltip(text, 'A')}
						synced={true}
						bind:syncZoom={dxfSyncZoom}
						bind:syncPanX={dxfSyncPanX}
						bind:syncPanY={dxfSyncPanY}
					/>
				</section>
				<section>
					<header>B · {selectedDxfB.name}</header>
					<DxfSchematicViewer
						text={selectedDxfB.text}
						comparisonText={selectedDxfA.text}
						diffRole="after"
						name={selectedDxfB.name}
						focusText={projectStore.selectedDesignator ?? projectStore.selectedNet}
						onTextClick={(text) => selectDxfText(text, 'B')}
						resolveTextTooltip={(text) => dxfTextTooltip(text, 'B')}
						synced={true}
						bind:syncZoom={dxfSyncZoom}
						bind:syncPanX={dxfSyncPanX}
						bind:syncPanY={dxfSyncPanY}
					/>
				</section>
			</div>
		{:else if renderMode === 'dxf' && projectStore.mode === 'compare' && dxfView === 'slider' && selectedDxfA && selectedDxfB}
			<div class="dxf-slider-compare" bind:this={dxfSliderContainer}>
				<div class="dxf-slider-layer">
					<DxfSchematicViewer
						text={selectedDxfA.text}
						comparisonText={selectedDxfB.text}
						diffRole="before"
						name={selectedDxfA.name}
						focusText={projectStore.selectedDesignator ?? projectStore.selectedNet}
						onTextClick={(text) => selectDxfText(text, 'A')}
						resolveTextTooltip={(text) => dxfTextTooltip(text, 'A')}
						synced={true}
						bind:syncZoom={dxfSyncZoom}
						bind:syncPanX={dxfSyncPanX}
						bind:syncPanY={dxfSyncPanY}
					/>
				</div>
				<div
					class="dxf-slider-layer dxf-slider-layer-b"
					style={`clip-path: inset(0 0 0 ${dxfSliderPosition * 100}%)`}
				>
					<DxfSchematicViewer
						text={selectedDxfB.text}
						comparisonText={selectedDxfA.text}
						diffRole="after"
						name={selectedDxfB.name}
						focusText={projectStore.selectedDesignator ?? projectStore.selectedNet}
						synced={true}
						bind:syncZoom={dxfSyncZoom}
						bind:syncPanX={dxfSyncPanX}
						bind:syncPanY={dxfSyncPanY}
					/>
				</div>
				<div
					class="dxf-slider-handle"
					style={`left:${dxfSliderPosition * 100}%`}
					role="slider"
					aria-label="DXF comparison split"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(dxfSliderPosition * 100)}
					tabindex="0"
					onpointerdown={onDxfSliderDown}
					onpointermove={onDxfSliderMove}
					onpointerup={onDxfSliderUp}
					onpointercancel={onDxfSliderUp}
					onkeydown={onDxfSliderKeyDown}
				>
					<span>⇆</span>
				</div>
				<span class="dxf-slider-label label-a">A</span>
				<span class="dxf-slider-label label-b">B</span>
			</div>
		{:else if renderMode === 'dxf' && (dxfView === 'a' ? selectedDxfA : (selectedDxfB ?? selectedDxfA))}
			{@const activeDxf = dxfView === 'a' ? selectedDxfA : (selectedDxfB ?? selectedDxfA)}
			{@const activeDxfSide = dxfView === 'a' ? 'A' : 'B'}
			{#if activeDxf}
				<DxfSchematicViewer
					text={activeDxf.text}
					comparisonText={projectStore.mode === 'compare'
						? activeDxfSide === 'A'
							? selectedDxfB?.text
							: selectedDxfA?.text
						: undefined}
					diffRole={projectStore.mode === 'compare'
						? activeDxfSide === 'A'
							? 'before'
							: 'after'
						: null}
					name={activeDxf.name}
					focusText={projectStore.selectedDesignator ?? projectStore.selectedNet}
					onTextClick={(text) => selectDxfText(text, activeDxfSide)}
					resolveTextTooltip={(text) => dxfTextTooltip(text, activeDxfSide)}
				/>
			{/if}
		{:else if renderMode === 'pdf' && smartPdf}
			<SmartPdfViewer url={smartPdf.url} name={smartPdf.name} />
		{:else if renderMode === 'sheet' && displayedLogicalSheet && hasFaithfulSheet}
			<FaithfulSchematicCanvas sheet={displayedLogicalSheet} channel={selectedChannel} />
		{:else if displayedLogicalSheet}
			<LogicalSchematicCanvas
				sheet={displayedLogicalSheet}
				baselineSheet={projectStore.mode === 'compare' && logicalVersion === 'changes'
					? selectedA?.sheets[0]
					: undefined}
				targetSide={logicalVersion === 'before' ? 'A' : 'B'}
				channel={selectedChannel}
			/>
		{/if}
	</div>
</div>

<style>
	.schematic-view {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: 236px minmax(0, 1fr);
		min-height: 0;
	}

	.schematic-view.minimal {
		grid-template-columns: 180px minmax(0, 1fr);
	}

	.schematic-view.minimal .diff-panel {
		gap: 9px;
		padding: 9px;
	}

	.schematic-view.minimal .change-list {
		display: none;
	}

	.diff-panel {
		border-right: 1px solid #d5dbe5;
		background: #ffffff;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: auto;
	}

	.canvas-area {
		min-width: 0;
		min-height: 0;
	}

	.dxf-compare {
		display: grid;
		grid-template-columns: 1fr 1fr;
		width: 100%;
		height: 100%;
		min-height: 0;
	}

	.dxf-compare section {
		position: relative;
		min-width: 0;
		min-height: 0;
		border-right: 1px solid #cbd5e1;
		overflow: hidden;
	}

	.dxf-compare section:last-child {
		border-right: 0;
	}

	.dxf-compare header {
		position: absolute;
		z-index: 5;
		top: 9px;
		left: 50%;
		max-width: calc(100% - 24px);
		border: 1px solid rgba(203, 213, 225, 0.8);
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.9);
		color: #475569;
		font-size: 0.68rem;
		font-weight: 800;
		overflow: hidden;
		padding: 5px 8px;
		text-overflow: ellipsis;
		transform: translateX(-50%);
		white-space: nowrap;
	}

	.dxf-slider-compare {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.dxf-slider-layer {
		position: absolute;
		inset: 0;
	}

	.dxf-slider-layer-b {
		z-index: 2;
		pointer-events: none;
	}

	.dxf-slider-handle {
		position: absolute;
		z-index: 6;
		top: 0;
		bottom: 0;
		width: 3px;
		background: #4f46e5;
		box-shadow:
			0 0 0 1px #ffffff,
			0 0 12px rgba(79, 70, 229, 0.45);
		cursor: ew-resize;
		transform: translateX(-50%);
		touch-action: none;
	}

	.dxf-slider-handle span {
		position: absolute;
		top: 50%;
		left: 50%;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 2px solid #ffffff;
		border-radius: 999px;
		background: #4f46e5;
		color: #ffffff;
		font-size: 0.82rem;
		transform: translate(-50%, -50%);
	}

	.dxf-slider-label {
		position: absolute;
		z-index: 5;
		top: 12px;
		border-radius: 5px;
		background: rgba(15, 23, 42, 0.82);
		color: #ffffff;
		font-size: 0.68rem;
		font-weight: 900;
		padding: 5px 8px;
		pointer-events: none;
	}

	.dxf-slider-label.label-a {
		left: 12px;
	}

	.dxf-slider-label.label-b {
		right: 12px;
	}

	.view-switch {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		border: 1px solid #cbd5e1;
		border-radius: 7px;
		overflow: hidden;
	}

	.view-switch button {
		border: 0;
		background: #f8fafc;
		color: #64748b;
		cursor: pointer;
		font-size: 0.72rem;
		font-weight: 800;
		padding: 7px;
	}

	.view-switch button.active {
		background: #2563eb;
		color: #ffffff;
	}

	.view-switch button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.logical-version {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
		margin-top: 6px;
		padding: 3px;
		border-radius: 7px;
		background: #eef2f7;
	}

	.logical-version.dxf-version {
		grid-template-columns: repeat(4, 1fr);
	}

	.logical-version button {
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: #64748b;
		cursor: pointer;
		font-size: 0.68rem;
		font-weight: 800;
		padding: 6px 3px;
	}

	.logical-version button.active {
		background: #ffffff;
		color: #4f46e5;
		box-shadow: 0 2px 7px rgba(15, 23, 42, 0.1);
	}

	.sheet-navigator {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 4px;
		margin-top: 6px;
		border: 1px solid #dbe2ec;
		border-radius: 7px;
		background: #f8fafc;
		padding: 3px;
	}

	.sheet-navigator button {
		min-height: 28px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: #475569;
		font-size: 0.68rem;
		font-weight: 850;
		padding: 0 6px;
	}

	.sheet-navigator button:hover:not(:disabled) {
		background: #e2e8f0;
	}

	.sheet-navigator button:disabled {
		cursor: default;
		opacity: 0.35;
	}

	.sheet-navigator strong {
		color: #1f2937;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.pdf-picker input {
		display: none;
	}

	.pdf-picker span {
		display: block;
		border: 1px dashed #94a3b8;
		border-radius: 6px;
		color: #475569;
		cursor: pointer;
		font-size: 0.7rem;
		font-weight: 700;
		overflow: hidden;
		padding: 7px 8px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	label {
		display: grid;
		gap: 7px;
		color: #526070;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.power-tree {
		border: 1px solid #cbd5e1;
		border-radius: 7px;
		background: #f8fafc;
		padding: 8px;
	}

	.power-tree summary {
		color: #334155;
		cursor: pointer;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.power-tree p {
		color: #64748b;
		font-size: 0.72rem;
	}

	.power-edges,
	.power-rails {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-top: 8px;
	}

	.power-tree button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 7px;
		border: 0;
		border-left: 3px solid #8b5cf6;
		border-radius: 4px;
		background: #ffffff;
		color: #334155;
		cursor: pointer;
		font-size: 0.7rem;
		padding: 6px 7px;
		text-align: left;
	}

	.power-tree button:hover {
		background: #f1f5f9;
	}

	.power-tree small {
		color: #64748b;
		font-size: 0.64rem;
	}

	select {
		border: 1px solid #d0d5dd;
		border-radius: 5px;
		background: #ffffff;
		color: #111827;
		font: inherit;
		min-height: 28px;
		width: 100%;
		padding: 0 8px;
	}

	.legend {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-bottom: 1px solid #e5e7eb;
		padding-bottom: 12px;
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

	.sheet-stats {
		display: flex;
		flex-direction: column;
		gap: 5px;
		border-radius: 6px;
		background: rgba(17, 24, 39, 0.82);
		color: #ffffff;
		font-size: 0.78rem;
		font-weight: 700;
		padding: 7px 9px;
	}

	.change-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.diff-filters {
		display: grid;
		grid-template-columns: 1.5fr repeat(3, 1fr);
		gap: 5px;
	}

	.change-list .diff-filters button {
		justify-content: center;
		border: 1px solid #dbe2ec;
		border-left: 3px solid #94a3b8;
		background: #ffffff;
		color: #64748b;
		font-size: 0.68rem;
		font-weight: 800;
		padding: 6px 4px;
	}

	.change-list .diff-filters button.added {
		border-left-color: #16a34a;
	}

	.change-list .diff-filters button.modified {
		border-left-color: #f97316;
	}

	.change-list .diff-filters button.removed {
		border-left-color: #dc2626;
	}

	.change-list .diff-filters button.active {
		border-color: #818cf8;
		background: #eef2ff;
		color: #4338ca;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
	}

	h3 {
		margin: 0 0 2px;
		color: #526070;
		font-size: 0.78rem;
		text-transform: uppercase;
	}

	.change-list button {
		border-left: 4px solid var(--status-color);
		border-radius: 6px;
		background: #f8fafc;
		color: #111827;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 10px;
		text-align: left;
	}

	.change-list button.selected {
		background: #fffbeb;
	}

	.change-list span {
		color: var(--status-color);
		font-weight: 800;
		text-transform: uppercase;
	}

	.change-list p {
		margin: 0;
		color: #667085;
		font-size: 0.83rem;
	}

	.diff-detail {
		margin-top: 6px;
		border: 1px solid #dbe2ec;
		border-radius: 9px;
		background: #ffffff;
		box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
		overflow: hidden;
	}

	.diff-detail header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 9px 10px;
		background: linear-gradient(90deg, #f8fafc, #f5f3ff);
	}

	.diff-detail header > div {
		display: flex;
		align-items: baseline;
		gap: 7px;
	}

	.diff-detail header small {
		color: #64748b;
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	.status-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #94a3b8;
	}

	.status-dot.added {
		background: #16a34a;
	}

	.status-dot.modified {
		background: #f97316;
	}

	.status-dot.removed {
		background: #dc2626;
	}

	.diff-columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px;
		padding: 6px 8px 2px 66px;
		color: #94a3b8;
		font-size: 0.6rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	.field-diff {
		padding: 6px 8px;
		border-top: 1px solid #eef2f6;
	}

	.field-label {
		display: block;
		margin-bottom: 4px;
		color: #64748b;
		font-size: 0.62rem;
		text-transform: uppercase;
	}

	.field-diff > div {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px;
		font-size: 0.67rem;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.field-diff del,
	.field-diff ins {
		border-radius: 4px;
		padding: 4px 5px;
		text-decoration: none;
	}

	.field-diff del {
		background: #fff1f2;
		color: #9f1239;
	}

	.field-diff ins {
		background: #f0fdf4;
		color: #166534;
	}

	.field-diff:not(.changed) del,
	.field-diff:not(.changed) ins {
		background: #f8fafc;
		color: #64748b;
	}

	.pin-diffs {
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-top: 1px solid #e2e8f0;
		padding: 8px;
	}

	.pin-diffs > strong {
		color: #475569;
		font-size: 0.65rem;
		text-transform: uppercase;
	}

	.pin-change {
		display: grid;
		gap: 2px;
		border-left: 3px solid #f97316;
		border-radius: 4px;
		background: #fff7ed;
		padding: 5px 6px;
		font-size: 0.66rem;
	}

	.pin-change.added {
		border-left-color: #16a34a;
		background: #f0fdf4;
	}

	.pin-change.removed {
		border-left-color: #dc2626;
		background: #fff1f2;
	}

	.pin-change small {
		color: #64748b;
		overflow-wrap: anywhere;
	}
</style>
