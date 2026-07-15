<script lang="ts">
	import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
	import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
	import { tick } from 'svelte';

	let {
		url,
		name,
		page = null,
		focusText = null
	}: { url: string; name: string; page?: number | null; focusText?: string | null } = $props();

	type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
	type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
	type PdfTextItem = {
		str: string;
		transform: number[];
		width: number;
		height: number;
	};
	type MatchSpan = { itemIndex: number; start: number; end: number; total: number };
	type Highlight = { left: number; top: number; width: number; height: number };

	pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

	let canvas = $state<HTMLCanvasElement | null>(null);
	let pdfScroll = $state<HTMLDivElement | null>(null);
	let pageShell = $state<HTMLDivElement | null>(null);
	let pdfDoc = $state<PdfDocument | null>(null);
	let pageCount = $state(0);
	let currentPage = $state(1);
	let zoom = $state(1.15);
	let loading = $state(false);
	let error = $state('');
	let searchQuery = $state('');
	let highlightedQuery = $state('');
	let searchStatus = $state('');
	let highlights = $state<Highlight[]>([]);
	let pageTextCache = new Map<number, PdfTextItem[]>();
	let loadToken = 0;
	let renderToken = 0;
	let pendingResultFocus = false;

	function clampPage(value: number) {
		return Math.max(1, Math.min(pageCount || 1, value));
	}

	function clampZoom(value: number) {
		return Math.max(0.45, Math.min(3, value));
	}

	function compact(value: string) {
		return value.toUpperCase().replace(/[^A-Z0-9_+\-/]/g, '');
	}

	async function loadPdf(sourceUrl: string) {
		const token = ++loadToken;
		loading = true;
		error = '';
		highlights = [];
		pageTextCache = new Map();
		try {
			const task = pdfjs.getDocument({ url: sourceUrl });
			const loaded = await task.promise;
			if (token !== loadToken) return;
			pdfDoc = loaded;
			pageCount = loaded.numPages;
			currentPage = clampPage(page ?? 1);
		} catch (cause) {
			if (token !== loadToken) return;
			error = cause instanceof Error ? cause.message : 'Unable to load PDF.';
			pdfDoc = null;
			pageCount = 0;
		} finally {
			if (token === loadToken) loading = false;
		}
	}

	async function getPageTextItems(pageNumber: number) {
		const cached = pageTextCache.get(pageNumber);
		if (cached) return cached;
		const doc = pdfDoc;
		if (!doc) return [];
		const pdfPage = await doc.getPage(pageNumber);
		const content = await pdfPage.getTextContent();
		const items = content.items
			.filter(
				(item): item is typeof item & PdfTextItem => 'str' in item && typeof item.str === 'string'
			)
			.map((item) => ({
				str: item.str,
				transform: [...item.transform],
				width: item.width,
				height: item.height
			}));
		pageTextCache.set(pageNumber, items);
		return items;
	}

	function matchingItemSpans(items: PdfTextItem[], query: string) {
		const target = compact(query);
		if (!target) return [];
		let text = '';
		const charRefs: { itemIndex: number; offset: number }[] = [];
		const itemLengths = new Map<number, number>();
		for (const [itemIndex, item] of items.entries()) {
			let itemOffset = 0;
			for (const char of item.str) {
				const normalized = compact(char);
				if (!normalized) continue;
				for (const normalizedChar of normalized) {
					text += normalizedChar;
					charRefs.push({ itemIndex, offset: itemOffset });
					itemOffset += 1;
				}
			}
			itemLengths.set(itemIndex, itemOffset);
		}
		const matchIndex = text.indexOf(target);
		if (matchIndex < 0) return [];
		const refs = charRefs.slice(matchIndex, matchIndex + target.length);
		const grouped = new Map<number, { start: number; end: number; total: number }>();
		for (const ref of refs) {
			const current = grouped.get(ref.itemIndex);
			const nextEnd = ref.offset + 1;
			if (current) {
				current.start = Math.min(current.start, ref.offset);
				current.end = Math.max(current.end, nextEnd);
			} else {
				grouped.set(ref.itemIndex, {
					start: ref.offset,
					end: nextEnd,
					total: itemLengths.get(ref.itemIndex) ?? nextEnd
				});
			}
		}
		return [...grouped.entries()].map(
			([itemIndex, span]): MatchSpan => ({
				itemIndex,
				start: span.start,
				end: span.end,
				total: Math.max(span.total, span.end, 1)
			})
		);
	}

	function textHighlightBox(item: PdfTextItem, span: MatchSpan, viewport: pdfjs.PageViewport) {
		const transform = pdfjs.Util.transform(viewport.transform, item.transform);
		const angle = Math.atan2(transform[1], transform[0]);
		const fontHeight = Math.max(Math.hypot(transform[2], transform[3]), 6);
		const fontAscent = fontHeight * 0.8;
		const fullWidth = Math.max(item.width * viewport.scale, 4);
		const start = fullWidth * (span.start / span.total);
		const end = fullWidth * (span.end / span.total);
		const width = Math.max(end - start, 4);
		const baseLeft =
			Math.abs(angle) < 0.0001 ? transform[4] : transform[4] + fontAscent * Math.sin(angle);
		const baseTop =
			Math.abs(angle) < 0.0001
				? transform[5] - fontAscent
				: transform[5] - fontAscent * Math.cos(angle);
		const advanceX = Math.cos(angle);
		const advanceY = Math.sin(angle);
		const blockX = -Math.sin(angle);
		const blockY = Math.cos(angle);
		const corners: [number, number][] = [
			[baseLeft + start * advanceX, baseTop + start * advanceY],
			[baseLeft + (start + width) * advanceX, baseTop + (start + width) * advanceY],
			[
				baseLeft + start * advanceX + fontHeight * blockX,
				baseTop + start * advanceY + fontHeight * blockY
			],
			[
				baseLeft + (start + width) * advanceX + fontHeight * blockX,
				baseTop + (start + width) * advanceY + fontHeight * blockY
			]
		];
		const minX = Math.min(...corners.map((point) => point[0]));
		const maxX = Math.max(...corners.map((point) => point[0]));
		const minY = Math.min(...corners.map((point) => point[1]));
		const maxY = Math.max(...corners.map((point) => point[1]));
		const pad = Math.max(3, viewport.scale * 1.8);
		return {
			left: minX - pad,
			top: minY - pad,
			width: Math.max(10, maxX - minX + pad * 2),
			height: Math.max(10, maxY - minY + pad * 2)
		};
	}

	async function findQuery(query: string) {
		const target = compact(query);
		if (!pdfDoc || !target) {
			searchStatus = '';
			highlightedQuery = '';
			highlights = [];
			return;
		}
		searchStatus = 'Searching...';
		for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
			const items = await getPageTextItems(pageNumber);
			if (matchingItemSpans(items, query).length === 0) continue;
			currentPage = pageNumber;
			highlightedQuery = query;
			zoom = Math.max(zoom, 2.05);
			pendingResultFocus = true;
			searchStatus = `Found on page ${pageNumber}`;
			await tick();
			await renderPage();
			return;
		}
		highlightedQuery = '';
		highlights = [];
		searchStatus = 'No match';
	}

	async function renderHighlights(pdfPage: PdfPage, viewport: pdfjs.PageViewport) {
		const query = highlightedQuery.trim();
		if (!query) {
			highlights = [];
			return;
		}
		const items = await getPageTextItems(currentPage);
		const matched = matchingItemSpans(items, query);
		if (matched.length === 0) {
			highlights = [];
			return;
		}
		highlights = matched
			.map((span) => {
				const item = items[span.itemIndex];
				if (!item) return null;
				return textHighlightBox(item, span, viewport);
			})
			.filter((highlight): highlight is Highlight => highlight !== null);
		if (pendingResultFocus) {
			pendingResultFocus = false;
			await tick();
			centerHighlightsInView();
		}
		void pdfPage;
	}

	function centerHighlightsInView() {
		const scroll = pdfScroll;
		const shell = pageShell;
		if (!scroll || !shell || highlights.length === 0) return;
		const minX = Math.min(...highlights.map((highlight) => highlight.left));
		const maxX = Math.max(...highlights.map((highlight) => highlight.left + highlight.width));
		const minY = Math.min(...highlights.map((highlight) => highlight.top));
		const maxY = Math.max(...highlights.map((highlight) => highlight.top + highlight.height));
		const centerX = shell.offsetLeft + (minX + maxX) / 2;
		const centerY = shell.offsetTop + (minY + maxY) / 2;
		scroll.scrollTo({
			left: Math.max(0, centerX - scroll.clientWidth / 2),
			top: Math.max(0, centerY - scroll.clientHeight / 2),
			behavior: 'smooth'
		});
	}

	async function renderPage() {
		const doc = pdfDoc;
		const targetCanvas = canvas;
		const shell = pageShell;
		if (!doc || !targetCanvas || !shell) return;
		const token = ++renderToken;
		const pdfPage = await doc.getPage(clampPage(currentPage));
		if (token !== renderToken) return;
		const viewport = pdfPage.getViewport({ scale: zoom });
		const context = targetCanvas.getContext('2d');
		if (!context) return;
		targetCanvas.width = Math.ceil(viewport.width);
		targetCanvas.height = Math.ceil(viewport.height);
		targetCanvas.style.width = `${viewport.width}px`;
		targetCanvas.style.height = `${viewport.height}px`;
		shell.style.width = `${viewport.width}px`;
		shell.style.height = `${viewport.height}px`;
		context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
		await pdfPage.render({ canvas: targetCanvas, canvasContext: context, viewport }).promise;
		if (token !== renderToken) return;
		await renderHighlights(pdfPage, viewport);
	}

	function submitSearch() {
		void findQuery(searchQuery);
	}

	function clearHighlights() {
		highlightedQuery = '';
		highlights = [];
		searchStatus = '';
	}

	function clearHighlightsOnClick(node: HTMLDivElement) {
		node.addEventListener('click', clearHighlights);
		return {
			destroy() {
				node.removeEventListener('click', clearHighlights);
			}
		};
	}

	function handlePdfWheel(event: WheelEvent) {
		if (!event.ctrlKey) return;
		event.preventDefault();
		event.stopPropagation();
		const direction = event.deltaY < 0 ? 1 : -1;
		zoom = clampZoom(zoom + direction * 0.15);
	}

	$effect(() => {
		void loadPdf(url);
	});

	$effect(() => {
		const next = focusText?.trim();
		if (!next || next === searchQuery) return;
		searchQuery = next;
		void findQuery(next);
	});

	$effect(() => {
		pdfDoc;
		currentPage;
		zoom;
		void renderPage();
	});
</script>

<div class="pdf-viewer">
	<header class="pdf-toolbar">
		<strong title={name}>{name}</strong>
		<div class="page-tools">
			<button
				disabled={currentPage <= 1}
				onclick={() => (currentPage = clampPage(currentPage - 1))}
			>
				Prev
			</button>
			<span>{currentPage} / {Math.max(pageCount, 1)}</span>
			<button
				disabled={currentPage >= pageCount}
				onclick={() => (currentPage = clampPage(currentPage + 1))}
			>
				Next
			</button>
		</div>
		<div class="zoom-tools">
			<button onclick={() => (zoom = clampZoom(zoom - 0.15))}>-</button>
			<span>{Math.round(zoom * 100)}%</span>
			<button onclick={() => (zoom = clampZoom(zoom + 0.15))}>+</button>
		</div>
		<form class="search-tools" onsubmit={(event) => (event.preventDefault(), submitSearch())}>
			<input bind:value={searchQuery} placeholder="Search reference" />
			<button disabled={!searchQuery.trim()}>Find</button>
			{#if searchStatus}<span>{searchStatus}</span>{/if}
		</form>
	</header>
	<div class="pdf-scroll" bind:this={pdfScroll} onwheel={handlePdfWheel}>
		{#if error}
			<div class="pdf-state">{error}</div>
		{:else if loading}
			<div class="pdf-state">Loading PDF...</div>
		{:else}
			<div class="pdf-page" bind:this={pageShell} use:clearHighlightsOnClick>
				<canvas bind:this={canvas}></canvas>
				{#each highlights as highlight}
					<i
						class="pdf-highlight"
						style={`left:${highlight.left}px;top:${highlight.top}px;width:${highlight.width}px;height:${highlight.height}px`}
					></i>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.pdf-viewer {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		background: #2b2d30;
		color: #f8fafc;
	}

	.pdf-toolbar {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 48px;
		border-bottom: 1px solid #3f444d;
		background: #24272b;
		padding: 7px 12px;
	}

	.pdf-toolbar strong {
		min-width: 160px;
		max-width: 340px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.page-tools,
	.zoom-tools,
	.search-tools {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	button,
	input {
		border: 1px solid #4b5563;
		border-radius: 5px;
		background: #111827;
		color: #f8fafc;
		font: inherit;
		font-size: 0.78rem;
		min-height: 30px;
		padding: 0 9px;
	}

	button:disabled {
		cursor: default;
		opacity: 0.45;
	}

	input {
		width: 180px;
		background: #f8fafc;
		color: #111827;
	}

	.pdf-toolbar span {
		color: #cbd5e1;
		font-size: 0.78rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.pdf-scroll {
		min-height: 0;
		overflow: auto;
		padding: 18px;
	}

	.pdf-page {
		position: relative;
		margin: 0 auto;
		background: #ffffff;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
	}

	canvas {
		display: block;
	}

	.pdf-highlight {
		position: absolute;
		z-index: 2;
		border: 3px solid #2563eb;
		border-radius: 5px;
		background: rgba(253, 224, 71, 0.48);
		box-shadow:
			0 0 0 3px rgba(255, 255, 255, 0.9),
			0 0 0 7px rgba(37, 99, 235, 0.22),
			0 0 18px rgba(37, 99, 235, 0.45);
		pointer-events: none;
	}

	.pdf-state {
		display: grid;
		place-items: center;
		min-height: 360px;
		color: #cbd5e1;
		font-weight: 800;
	}
</style>
