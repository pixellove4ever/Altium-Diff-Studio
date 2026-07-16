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
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';
	import type { AltiumSchMarker, AltiumSchSheet, AltiumSchematicDoc } from '$lib/types/altium';

	const schematicA = $derived(projectStore.projectA.schematic);
	const schematicB = $derived(
		projectStore.mode === 'view' ? projectStore.projectA.schematic : projectStore.projectB.schematic
	);
	let selectedSheetIndex = $state(0);
	let selectedChannel = $state('');
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
	const smartPdf = $derived(projectStore.mode === 'view' ? projectStore.pdfA : null);
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
	type LogicBlockStatus = 'unchanged' | 'modified' | 'added' | 'removed';
	const logicCompareBlocks = $derived.by(() => {
		const maxLength = Math.max(schematicA?.sheets.length ?? 0, schematicB?.sheets.length ?? 0);
		const instancesA = schematicInstancesBySheet(schematicA);
		const instancesB = schematicInstancesBySheet(schematicB);
		return Array.from({ length: maxLength }, (_, index) => {
			const before = schematicA?.sheets[index] ?? null;
			const after = schematicB?.sheets[index] ?? null;
			const status: LogicBlockStatus = !before
				? 'added'
				: !after
					? 'removed'
					: sheetCompareSignature(before) === sheetCompareSignature(after)
						? 'unchanged'
						: 'modified';
			const sheet = after ?? before;
			const instanceNames = Array.from(
				new Set([...(instancesA.get(index) ?? []), ...(instancesB.get(index) ?? [])])
			).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
			return {
				index,
				status,
				label: sheetLabel(sheet, index),
				fileName: sheet?.fileName ?? '',
				componentCount: sheet?.components.length ?? 0,
				wireCount: sheet?.wires.length ?? 0,
				childCount: sheet?.sheetSymbols?.length ?? 0,
				instances: instanceNames
			};
		}).flatMap((block) =>
			block.instances.length > 0
				? block.instances.map((instance) => ({ ...block, instance }))
				: [{ ...block, instance: '' }]
		);
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
		const selected = projectStore.selectedDesignator?.replace(/_[A-Za-z]*\d+$/, '').toUpperCase();
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
				const repeat = name.match(/^Repeat\(\s*([^,]*?)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
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
		for (const instance of [
			...(schematicInstancesBySheet(schematicA).get(selectedSheetIndex) ?? []),
			...(schematicInstancesBySheet(schematicB).get(selectedSheetIndex) ?? [])
		]) {
			result.push(instance);
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
		if (viewerStore.schematicRenderModeExplicit) return;
		if (viewerStore.schematicRenderMode === 'pdf') return;
		if (selectedDxf && !dxfAutoActivated) {
			viewerStore.setSchematicRenderMode('dxf', false);
			dxfAutoActivated = true;
		}
		if (!selectedDxf) dxfAutoActivated = false;
	});

	$effect(() => {
		if (viewerStore.schematicRenderModeExplicit) return;
		if (!smartPdf) return;
		if (schematicA || schematicB || selectedDxf) return;
		viewerStore.setSchematicRenderMode('pdf', false);
	});

	$effect(() => {
		if (viewerStore.schematicRenderMode !== 'pdf' || smartPdf) return;
		viewerStore.setSchematicRenderMode(
			selectedDxf ? 'dxf' : schematicA || schematicB ? 'logical' : 'pdf',
			false
		);
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
		const channelMatch = selected.match(/_([A-Za-z]*\d+)$/);
		const designator = selected
			.replace(/_[A-Za-z]*\d+$/, '')
			.trim()
			.toUpperCase();
		const hasDesignator = (sheet: AltiumSchematicDoc['sheets'][number]) =>
			sheet.components.some(
				(component) => component.designator.trim().toUpperCase() === designator
			);
		const candidateSheets = schematicB?.sheets ?? [];
		let sheetIndex = candidateSheets.findIndex(hasDesignator);
		if (sheetIndex < 0) {
			sheetIndex = schematicA?.sheets.findIndex(hasDesignator) ?? -1;
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
		if (viewerStore.schematicRenderMode === 'pdf') return;
		selectSheet(selectedSheetIndex + delta);
	}

	function sheetLabel(sheet: AltiumSchSheet | null | undefined, index: number) {
		return sheet?.name || sheet?.fileName?.replace(/\.[^.]+$/, '') || `Sheet ${index + 1}`;
	}

	function markerName(marker: { name?: string; text?: string }) {
		return marker.name || marker.text || '';
	}

	function schematicReferenceKeys(value: string | undefined) {
		if (!value?.trim()) return [];
		const normalized = value.trim().replaceAll('\\', '/').toUpperCase();
		const fileName = normalized.split('/').at(-1) ?? normalized;
		const stem = fileName.replace(/\.[^.]+$/, '');
		return Array.from(new Set([normalized, fileName, stem]));
	}

	function channelNamesFromSheetSymbol(symbol: { name?: string; text?: string }) {
		const name = markerName(symbol).trim();
		if (!name) return [];
		const repeat = name.match(/^Repeat\(\s*([^,]*?)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
		if (!repeat) return [];
		const prefix = repeat[1].trim();
		const start = Number(repeat[2]);
		const end = Number(repeat[3]);
		if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
		const step = start <= end ? 1 : -1;
		return Array.from({ length: Math.abs(end - start) + 1 }, (_, index) => {
			const value = start + index * step;
			return `${prefix}${value}`;
		});
	}

	function schematicInstancesBySheet(doc: AltiumSchematicDoc | null) {
		const result = new Map<number, string[]>();
		if (!doc) return result;
		const sheetsByReference = new Map<string, { index: number; sheet: AltiumSchSheet }>();
		for (const [index, sheet] of doc.sheets.entries()) {
			for (const key of [
				...schematicReferenceKeys(sheet.fileName),
				...schematicReferenceKeys(sheet.path),
				...schematicReferenceKeys(sheet.name)
			]) {
				if (!sheetsByReference.has(key)) sheetsByReference.set(key, { index, sheet });
			}
		}
		const refs: Array<{ childIndex: number; symbolName: string; repeatChannels: string[] }> = [];
		for (const [parentIndex, sheet] of doc.sheets.entries()) {
			for (const symbol of sheet.sheetSymbols ?? []) {
				const child = [
					...schematicReferenceKeys(symbol.fileName),
					...schematicReferenceKeys(markerName(symbol))
				]
					.map((key) => sheetsByReference.get(key))
					.find((candidate) => candidate && candidate.index !== parentIndex);
				if (!child) continue;
				refs.push({
					childIndex: child.index,
					symbolName: markerName(symbol).trim(),
					repeatChannels: channelNamesFromSheetSymbol(symbol)
				});
			}
		}
		const refsByChild = new Map<number, typeof refs>();
		for (const ref of refs) {
			const entries = refsByChild.get(ref.childIndex) ?? [];
			entries.push(ref);
			refsByChild.set(ref.childIndex, entries);
		}
		for (const ref of refs) {
			const childRefs = refsByChild.get(ref.childIndex) ?? [];
			const channels =
				ref.repeatChannels.length > 0
					? ref.repeatChannels
					: childRefs.length > 1
						? [ref.symbolName]
						: [];
			if (channels.length === 0) continue;
			const entries = result.get(ref.childIndex) ?? [];
			for (const channel of channels) {
				const normalized = channel.trim();
				if (normalized) entries.push(normalized);
			}
			result.set(ref.childIndex, entries);
		}
		return new Map(
			Array.from(result.entries()).map(([index, entries]) => [
				index,
				Array.from(new Set(entries)).sort((left, right) =>
					left.localeCompare(right, undefined, { numeric: true })
				)
			])
		);
	}

	function sheetCompareSignature(sheet: AltiumSchSheet) {
		const compactPoint = (point: { x: number; y: number }) => [
			Math.round(point.x * 10) / 10,
			Math.round(point.y * 10) / 10
		];
		return JSON.stringify({
			components: sheet.components
				.map((component) => ({
					designator: component.designator,
					comment: component.comment,
					libRef: component.libRef,
					value: component.value,
					footprint: component.footprint,
					pins: component.pins.map((pin) => ({
						num: pin.num,
						name: pin.name,
						hidden: pin.hidden,
						hiddenNetName: pin.hiddenNetName
					}))
				}))
				.sort((left, right) =>
					left.designator.localeCompare(right.designator, undefined, { numeric: true })
				),
			wires: sheet.wires.map((wire) => ({
				net: wire.net,
				points: (wire.points ?? [wire.start, wire.end])
					.filter((point): point is { x: number; y: number } => !!point)
					.map(compactPoint)
			})),
			labels: sheet.netLabels.map((label) => ({ text: label.text, x: label.x, y: label.y })),
			ports: [
				...(sheet.ports ?? []),
				...(sheet.powerPorts ?? []),
				...(sheet.offSheetConnectors ?? [])
			]
				.map((marker) => marker.name || marker.text || '')
				.sort(),
			sheetSymbols: (sheet.sheetSymbols ?? [])
				.map((symbol) => ({
					name: symbol.name || symbol.text || '',
					fileName: symbol.fileName || ''
				}))
				.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
			sheetEntries: (sheet.sheetEntries ?? []).map((entry) => entry.name || entry.text || '').sort()
		});
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

	function selectDxfText(text: string, side: 'A' | 'B' = 'B') {
		const index =
			side === 'A' || projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB;
		const link = resolveDxfTextLink(text, index, { preferredChannel: selectedChannel });
		if (!link) return;
		if (link.kind === 'component') projectStore.selectDesignator(link.designator);
		else projectStore.selectNet(link.net);
	}

	function dxfTextTooltip(text: string, side: 'A' | 'B' = 'B') {
		const index =
			side === 'A' || projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB;
		return resolveDxfTextLink(text, index, { preferredChannel: selectedChannel })?.tooltip ?? null;
	}

	function selectPdfReference(reference: string) {
		const value = reference.trim();
		if (!value) return;
		const index = projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB;
		const key = value.toUpperCase();
		if (index.byDesignator.has(key)) {
			projectStore.selectDesignator(value);
			return;
		}
		if (index.byNet.has(key)) projectStore.selectNet(value);
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
	class:pdf-mode={viewerStore.schematicRenderMode === 'pdf'}
	class:logical-mode={viewerStore.schematicRenderMode === 'logical'}
	class:dxf-mode={viewerStore.schematicRenderMode === 'dxf'}
	role="region"
	aria-label="Schematic viewer"
>
	{#if viewerStore.schematicRenderMode !== 'pdf' && viewerStore.schematicRenderMode !== 'logical' && viewerStore.schematicRenderMode !== 'dxf'}
		<aside class="diff-panel">
			<div class="page-control">
				{#if projectStore.mode === 'compare' && viewerStore.schematicRenderMode === 'sheet' && !viewerStore.minimalUi}
					<div class="logical-version" aria-label="Logical comparison version">
						<button
							class:active={logicalVersion === 'before'}
							onclick={() => (logicalVersion = 'before')}
							>{localeStore.t('schematic.before')}</button
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
							<p>
								{visibleWireDiff.length} wire changes, {visibleNetLabelDiff.length} label changes
							</p>
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
	{/if}
	<div class="canvas-area">
		{#if viewerStore.schematicRenderMode === 'dxf'}
			<div class="dxf-floating-controls">
				{#if projectStore.mode === 'compare' && !viewerStore.minimalUi}
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
			</div>
		{/if}
		{#if viewerStore.schematicRenderMode === 'dxf' && projectStore.mode === 'compare' && dxfView === 'compare' && selectedDxfA && selectedDxfB}
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
		{:else if viewerStore.schematicRenderMode === 'dxf' && projectStore.mode === 'compare' && dxfView === 'slider' && selectedDxfA && selectedDxfB}
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
		{:else if viewerStore.schematicRenderMode === 'dxf' && (dxfView === 'a' ? selectedDxfA : (selectedDxfB ?? selectedDxfA))}
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
		{:else if viewerStore.schematicRenderMode === 'pdf' && smartPdf}
			<SmartPdfViewer
				url={smartPdf.url}
				name={smartPdf.name}
				focusText={projectStore.selectedDesignator}
				onReferenceFound={selectPdfReference}
			/>
		{:else if viewerStore.schematicRenderMode === 'logical' && projectStore.mode === 'compare'}
			<section class="logic-compare-overview" aria-label="Logic comparison overview">
				<div class="logic-overview-header">
					<div>
						<strong>LOGIC</strong>
						<span>{logicCompareBlocks.length} pages - changed blocks highlighted</span>
					</div>
					<div class="logic-overview-legend">
						<span><i class="unchanged"></i>unchanged</span>
						<span><i class="modified"></i>changed</span>
						<span><i class="added"></i>added</span>
						<span><i class="removed"></i>removed</span>
					</div>
				</div>
				<div class="logic-block-grid">
					{#each logicCompareBlocks as block}
						<button
							class={`logic-block ${block.status}`}
							class:selected={selectedSheetIndex === block.index &&
								selectedChannel === block.instance}
							onclick={() => {
								selectSheet(block.index);
								selectedChannel = block.instance;
							}}
						>
							<strong>{block.instance ? `${block.label} · ${block.instance}` : block.label}</strong>
							<span>{block.fileName || `Page ${block.index + 1}`}</span>
							<small>
								{block.componentCount} comp - {block.wireCount} wires
								{#if block.childCount > 0}
									- {block.childCount} child blocks{/if}
							</small>
						</button>
					{/each}
				</div>
			</section>
		{:else if viewerStore.schematicRenderMode === 'sheet' && displayedLogicalSheet && hasFaithfulSheet}
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

	.schematic-view.pdf-mode {
		grid-template-columns: minmax(0, 1fr);
	}

	.schematic-view.logical-mode {
		grid-template-columns: minmax(0, 1fr);
	}

	.schematic-view.dxf-mode {
		grid-template-columns: minmax(0, 1fr);
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
		position: relative;
		min-width: 0;
		min-height: 0;
	}

	.dxf-floating-controls {
		position: absolute;
		z-index: 20;
		top: 10px;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: calc(100% - 24px);
		border: 1px solid rgba(203, 213, 225, 0.88);
		border-radius: 9px;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
		padding: 5px;
		transform: translateX(-50%);
		backdrop-filter: blur(8px);
	}

	.dxf-floating-controls .logical-version,
	.dxf-floating-controls .sheet-navigator {
		margin-top: 0;
	}

	.dxf-floating-controls label {
		min-height: 28px;
		margin: 0;
		font-size: 0.68rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.dxf-floating-controls select {
		max-width: 150px;
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

	.logic-compare-overview {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 18px;
		width: 100%;
		height: 100%;
		min-height: 0;
		background: #f8fafc;
		padding: 24px;
	}

	.logic-overview-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
	}

	.logic-overview-header > div:first-child {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.logic-overview-header strong {
		color: #111827;
		font-size: 1.05rem;
		letter-spacing: 0.08em;
	}

	.logic-overview-header span {
		color: #64748b;
		font-size: 0.76rem;
		font-weight: 750;
	}

	.logic-overview-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.logic-overview-legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		text-transform: uppercase;
	}

	.logic-overview-legend i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: #cbd5e1;
	}

	.logic-overview-legend i.modified {
		background: #f97316;
	}

	.logic-overview-legend i.added {
		background: #22c55e;
	}

	.logic-overview-legend i.removed {
		background: #ef4444;
	}

	.logic-block-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		align-content: start;
		gap: 14px;
		min-height: 0;
		overflow: auto;
		padding-right: 4px;
	}

	.logic-block {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-height: 118px;
		border: 1px solid #cbd5e1;
		border-left: 6px solid #94a3b8;
		border-radius: 4px;
		background: #f1f5f9;
		color: #1f2937;
		cursor: pointer;
		padding: 14px 14px 12px;
		text-align: left;
		box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
	}

	.logic-block::after {
		content: '';
		position: absolute;
		right: 12px;
		bottom: 10px;
		width: 18px;
		height: 18px;
		border-right: 2px solid rgba(100, 116, 139, 0.55);
		border-bottom: 2px solid rgba(100, 116, 139, 0.55);
	}

	.logic-block:hover,
	.logic-block.selected {
		border-color: #64748b;
		box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
		transform: translateY(-1px);
	}

	.logic-block.modified {
		border-left-color: #f97316;
		background: #fff7ed;
	}

	.logic-block.added {
		border-left-color: #22c55e;
		background: #f0fdf4;
	}

	.logic-block.removed {
		border-left-color: #ef4444;
		background: #fff1f2;
	}

	.logic-block strong {
		color: #111827;
		font-size: 0.92rem;
	}

	.logic-block span {
		color: #475569;
		font-size: 0.76rem;
		font-weight: 800;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.logic-block small {
		color: #64748b;
		font-size: 0.68rem;
		font-weight: 750;
		line-height: 1.35;
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
