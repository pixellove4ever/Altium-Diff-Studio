<script lang="ts">
	import ProjectDropZone from '$lib/components/ProjectDropZone.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { importStore } from '$lib/state/importStore.svelte';
	import { viewerStore } from '$lib/state/viewerStore.svelte';

	interface Props {
		modeChosen: boolean;
		hasLoadedA: boolean;
		projectIdentityA: { label: string };
		baselineSummary: string;
	}
	
	let {
		modeChosen = $bindable(),
		hasLoadedA,
		projectIdentityA,
		baselineSummary
	}: Props = $props();

	let homeDragMode = $state<'view' | 'compare' | null>(null);

	const projectFileAccept =
		'.json,.pdf,.dxf,.gbr,.ger,.pho,.art,.gtl,.gbl,.gts,.gbs,.gtp,.gbp,.gto,.gbo,.g1,.g2,.g3,.g4,.g5,.g6,.g7,.g8,.g9,.g10,.g11,.g12,.g13,.g14,.g15,.g16,.gm1,.gm2,.gm3,.gm4,.gm5,.gm6,.gm7,.gm8,.gm9,.gm10,.gm11,.gm12,.gm13,.gm14,.gm15,.gm16,.gd1,.gg1,.apr,.gko,.gml,.drl,.xln,.odb,.odb++,.tgz,.tar,.gz,.zip,application/json,application/pdf';

	function chooseMode(mode: 'compare' | 'view') {
		importStore.reset();
		projectStore.setMode(mode);
		viewerStore.resetSchematicRenderPreference();
		modeChosen = true;
	}

	async function importHomeFiles(mode: 'compare' | 'view', files: FileList | File[] | null) {
		if (!files || files.length === 0) return;
		importStore.reset();
		projectStore.setMode(mode);
		viewerStore.resetSchematicRenderPreference();
		await importStore.loadBrowserFiles('A', files);
		modeChosen = mode === 'compare' || projectStore.isReady;
	}

	function onHomeInput(mode: 'compare' | 'view', event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		void importHomeFiles(mode, files);
	}

	function onHomeDrop(mode: 'compare' | 'view', event: DragEvent) {
		event.preventDefault();
		homeDragMode = null;
		void importHomeFiles(mode, event.dataTransfer?.files ?? null);
	}

	const importing = $derived(importStore.loadingSide !== null);
</script>

{#if !modeChosen}
	<section class="mode-choice">
		<div
			class="mode-card"
			class:dragging={homeDragMode === 'view'}
			role="group"
			aria-label={localeStore.t('mode.view.title')}
			ondragenter={() => (homeDragMode = 'view')}
			ondragleave={() => (homeDragMode = null)}
			ondragover={(event) => event.preventDefault()}
			ondrop={(event) => onHomeDrop('view', event)}
		>
			<div class="mode-icon" aria-hidden="true">+</div>
			<div>
				<strong>{localeStore.t('mode.view.title')}</strong>
				<span>{localeStore.t('mode.view.description')}</span>
			</div>
			<p>{localeStore.t('mode.dropHint')}</p>
			<div class="mode-actions">
				<label>
					<input
						type="file"
						accept={projectFileAccept}
						multiple
						onchange={(event) => onHomeInput('view', event)}
					/>
					<span
						><svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></svg
						>{localeStore.t('mode.files')}</span
					>
				</label>
				<label>
					<input
						type="file"
						accept={projectFileAccept}
						multiple
						webkitdirectory
						onchange={(event) => onHomeInput('view', event)}
					/>
					<span
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg
						>{localeStore.t('mode.folder')}</span
					>
				</label>
			</div>
		</div>
		<div
			class="mode-card"
			class:dragging={homeDragMode === 'compare'}
			role="group"
			aria-label={localeStore.t('mode.compare.title')}
			ondragenter={() => (homeDragMode = 'compare')}
			ondragleave={() => (homeDragMode = null)}
			ondragover={(event) => event.preventDefault()}
			ondrop={(event) => onHomeDrop('compare', event)}
		>
			<div class="mode-icon" aria-hidden="true">+</div>
			<div>
				<strong>{localeStore.t('mode.compare.title')}</strong>
				<span>{localeStore.t('mode.compare.description')}</span>
			</div>
			<p>{localeStore.t('mode.compareDropHint')}</p>
			<div class="mode-actions">
				<label>
					<input
						type="file"
						accept={projectFileAccept}
						multiple
						onchange={(event) => onHomeInput('compare', event)}
					/>
					<span
						><svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></svg
						>{localeStore.t('mode.files')}</span
					>
				</label>
				<label>
					<input
						type="file"
						accept={projectFileAccept}
						multiple
						webkitdirectory
						onchange={(event) => onHomeInput('compare', event)}
					/>
					<span
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg
						>{localeStore.t('mode.folder')}</span
					>
				</label>
			</div>
		</div>
	</section>
{:else}
	<section class="landing" class:importing>
		{#if projectStore.mode === 'compare' && hasLoadedA}
			<section class="loaded-baseline" aria-label="Loaded baseline">
				<header>
					<span>Version A · {projectIdentityA.label}</span>
					<h2>{localeStore.t('app.baselineLoaded')}</h2>
				</header>
				<p>{baselineSummary || localeStore.t('app.projectDataReady')}</p>
				<button onclick={() => chooseMode('view')}>{localeStore.t('app.backToViewer')}</button>
			</section>
		{:else}
			<ProjectDropZone
				side="A"
				title={projectStore.mode === 'view'
					? localeStore.t('app.projectExport')
					: localeStore.t('app.baselineExport')}
			/>
		{/if}
		{#if projectStore.mode === 'compare'}
			<ProjectDropZone side="B" title={localeStore.t('app.candidateExport')} />
		{/if}
	</section>
{/if}
