<script lang="ts">
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { reviewStore } from '$lib/state/reviewStore.svelte';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { getPcbDiffBundle, getBomDiff } from '$lib/diff/altiumDiff';
	import { inferProjectIdentity } from '$lib/domain/projectIdentity';

	const identityA = $derived(
		inferProjectIdentity(
			[
				...projectStore.filesA,
				...(projectStore.pdfA ? [projectStore.pdfA] : []),
				...projectStore.dxfA,
				...projectStore.gerberA,
				...projectStore.odbA
			],
			'Version Vn (A)'
		)
	);

	const identityB = $derived(
		inferProjectIdentity(
			[
				...projectStore.filesB,
				...(projectStore.pdfB ? [projectStore.pdfB] : []),
				...projectStore.dxfB,
				...projectStore.gerberB,
				...projectStore.odbB
			],
			'Version Vn+1 (B)'
		)
	);

	const bomDiff = $derived(getBomDiff(projectStore.projectA.bom, projectStore.projectB.bom));

	const pcbDiff = $derived(
		getPcbDiffBundle(projectStore.projectA.pcb, projectStore.projectB.pcb)
	);

	const bomDiffAdded = $derived(bomDiff.filter((row) => row.status === 'added'));
	const bomDiffRemoved = $derived(bomDiff.filter((row) => row.status === 'removed'));
	const bomDiffModified = $derived(bomDiff.filter((row) => row.status === 'modified'));

	const stats = $derived.by(() => {
		const added =
			bomDiffAdded.length + pcbDiff.components.filter((c) => c.status === 'added').length;
		const removed =
			bomDiffRemoved.length + pcbDiff.components.filter((c) => c.status === 'removed').length;
		const modified =
			bomDiffModified.length + pcbDiff.components.filter((c) => c.status === 'modified').length;
		return { added, removed, modified, total: added + removed + modified };
	});

	const currentDate = new Date().toLocaleDateString('fr-FR', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	function printPDF() {
		window.print();
	}

	function exportMarkdown() {
		let md = `# Rapport de Validation de Modification (Vn → Vn+1)\n\n`;
		md += `**Date de génération :** ${currentDate}\n`;
		md += `**Version A (Vn) :** ${identityA.name || 'Version A'}\n`;
		md += `**Version B (Vn+1) :** ${identityB.name || 'Version B'}\n\n`;
		md += `## Résumé des Modifications\n\n`;
		md += `- **Modifications totales :** ${stats.total}\n`;
		md += `- **Composants ajoutés :** ${stats.added}\n`;
		md += `- **Composants supprimés :** ${stats.removed}\n`;
		md += `- **Composants modifiés :** ${stats.modified}\n\n`;
		md += `## Matrice de Révision BOM & PCB\n\n`;
		md += `| Désignateur | Statut | Valeur Vn | Valeur Vn+1 | Empreinte Vn | Empreinte Vn+1 |\n`;
		md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

		for (const mod of bomDiffModified) {
			md += `| ${mod.designator} | Modifié | ${mod.before?.comment || '-'} | ${mod.after?.comment || '-'} | ${mod.before?.footprint || '-'} | ${mod.after?.footprint || '-'} |\n`;
		}
		for (const add of bomDiffAdded) {
			md += `| ${add.designator} | Ajouté | - | ${add.after?.comment || '-'} | - | ${add.after?.footprint || '-'} |\n`;
		}
		for (const rem of bomDiffRemoved) {
			md += `| ${rem.designator} | Supprimé | ${rem.before?.comment || '-'} | - | ${rem.before?.footprint || '-'} | - |\n`;
		}

		const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `Rapport_Validation_${identityA.name || 'Project'}_Vn_Vn1.md`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="report-container">
	<header class="report-header-toolbar no-print">
		<div>
			<h2>Rapport de Validation (Vn → Vn+1)</h2>
			<p>Génération automatique du dossier de révision électronique et nomenclature.</p>
		</div>
		<div class="actions">
			<button class="btn" onclick={exportMarkdown}>Exporter Markdown</button>
			<button class="btn primary" onclick={printPDF}>Imprimer / Exporter PDF</button>
		</div>
	</header>

	<article class="report-document">
		<header class="document-title">
			<div class="badge-env">ADS VALIDATION REPORT</div>
			<h1>Rapport de Modification Vn → Vn+1</h1>
			<p class="subtitle">Validation de conformité schéma, PCB et nomenclature</p>
			<div class="meta-grid">
				<div>
					<strong>Projet :</strong>
					<span>{identityA.name || 'Altium Project'}</span>
				</div>
				<div>
					<strong>Date de validation :</strong>
					<span>{currentDate}</span>
				</div>
				<div>
					<strong>Baseline (Vn) :</strong>
					<span>{identityA.name} (Version A)</span>
				</div>
				<div>
					<strong>Révision (Vn+1) :</strong>
					<span>{identityB.name} (Version B)</span>
				</div>
			</div>
		</header>

		<section class="section-summary">
			<h3>1. Synthèse Exécutive des Changements</h3>
			<div class="kpi-grid">
				<div class="kpi-card total">
					<span class="value">{stats.total}</span>
					<span class="label">Éléments impactés</span>
				</div>
				<div class="kpi-card modified">
					<span class="value">{stats.modified}</span>
					<span class="label">Composants Modifiés</span>
				</div>
				<div class="kpi-card added">
					<span class="value">{stats.added}</span>
					<span class="label">Composants Ajoutés</span>
				</div>
				<div class="kpi-card removed">
					<span class="value">{stats.removed}</span>
					<span class="label">Composants Supprimés</span>
				</div>
			</div>
		</section>

		<section class="section-matrix">
			<h3>2. Matrice Comparative Nomenclature (BOM)</h3>
			<table class="report-table">
				<thead>
					<tr>
						<th>Désignateur</th>
						<th>Statut</th>
						<th>Valeur Vn (Avant)</th>
						<th>Valeur Vn+1 (Après)</th>
						<th>Empreinte Vn</th>
						<th>Empreinte Vn+1</th>
					</tr>
				</thead>
				<tbody>
					{#each bomDiffModified as mod}
						<tr class="status-row modified">
							<td><strong>{mod.designator}</strong></td>
							<td><span class="tag modified">Modifié</span></td>
							<td>{mod.before?.comment || '-'}</td>
							<td class="diff-new">{mod.after?.comment || '-'}</td>
							<td>{mod.before?.footprint || '-'}</td>
							<td class="diff-new">{mod.after?.footprint || '-'}</td>
						</tr>
					{/each}
					{#each bomDiffAdded as add}
						<tr class="status-row added">
							<td><strong>{add.designator}</strong></td>
							<td><span class="tag added">Ajouté</span></td>
							<td>-</td>
							<td class="diff-new">{add.after?.comment || '-'}</td>
							<td>-</td>
							<td class="diff-new">{add.after?.footprint || '-'}</td>
						</tr>
					{/each}
					{#each bomDiffRemoved as rem}
						<tr class="status-row removed">
							<td><strong>{rem.designator}</strong></td>
							<td><span class="tag removed">Supprimé</span></td>
							<td>{rem.before?.comment || '-'}</td>
							<td>-</td>
							<td>{rem.before?.footprint || '-'}</td>
							<td>-</td>
						</tr>
					{/each}
					{#if bomDiffModified.length === 0 && bomDiffAdded.length === 0 && bomDiffRemoved.length === 0}
						<tr>
							<td colspan="6" class="empty-table"
								>Aucune modification de composant détectée entre Vn et Vn+1.</td
							>
						</tr>
					{/if}
				</tbody>
			</table>
		</section>

		<section class="section-pcb">
			<h3>3. Delta Routage PCB & Pistes</h3>
			<div class="pcb-stats-box">
				<p>
					<strong>Pistes modifiées :</strong>
					{pcbDiff.tracks.filter((t) => t.status !== 'unchanged').length} pistes
				</p>
				<p>
					<strong>Vias ajoutés/supprimés :</strong>
					{pcbDiff.vias.filter((v) => v.status !== 'unchanged').length} vias
				</p>
				<p>
					<strong>Polygones & Plans :</strong>
					{pcbDiff.polygons.filter((p) => p.status !== 'unchanged').length} polygones modifiés
				</p>
			</div>
		</section>

		<footer class="report-footer-signatures">
			<div class="sig-box">
				<span>Rédigé par (Ingénierie CAO) :</span>
				<div class="sig-line"></div>
			</div>
			<div class="sig-box">
				<span>Approuvé par (Validation Produit) :</span>
				<div class="sig-line"></div>
			</div>
		</footer>
	</article>
</div>

<style>
	.report-container {
		padding: 24px;
		max-width: 1000px;
		margin: 0 auto;
		font-family: Inter, system-ui, sans-serif;
		color: #0f172a;
	}

	.report-header-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #ffffff;
		padding: 16px 24px;
		border-radius: 10px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		margin-bottom: 24px;
		border: 1px solid #e2e8f0;
	}

	.report-header-toolbar h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
	}

	.report-header-toolbar p {
		margin: 4px 0 0;
		font-size: 13px;
		color: #64748b;
	}

	.actions {
		display: flex;
		gap: 12px;
	}

	.btn {
		padding: 8px 16px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		border: 1px solid #cbd5e1;
		background: #ffffff;
		cursor: pointer;
	}

	.btn.primary {
		background: #2563eb;
		color: #ffffff;
		border-color: #1d4ed8;
	}

	.report-document {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 40px;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
	}

	.document-title {
		border-bottom: 2px solid #e2e8f0;
		padding-bottom: 24px;
		margin-bottom: 32px;
	}

	.badge-env {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.1em;
		color: #2563eb;
		margin-bottom: 6px;
	}

	.document-title h1 {
		margin: 0 0 6px;
		font-size: 26px;
		font-weight: 800;
	}

	.subtitle {
		color: #64748b;
		margin: 0 0 20px;
		font-size: 14px;
	}

	.meta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		background: #f8fafc;
		padding: 16px;
		border-radius: 8px;
		font-size: 13px;
	}

	.meta-grid strong {
		color: #475569;
	}

	.kpi-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
		margin: 20px 0 32px;
	}

	.kpi-card {
		padding: 16px;
		border-radius: 8px;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.kpi-card .value {
		font-size: 28px;
		font-weight: 800;
	}

	.kpi-card .label {
		font-size: 12px;
		font-weight: 600;
		color: #64748b;
		margin-top: 4px;
	}

	.kpi-card.modified .value {
		color: #d97706;
	}

	.kpi-card.added .value {
		color: #16a34a;
	}

	.kpi-card.removed .value {
		color: #dc2626;
	}

	.report-table {
		width: 100%;
		border-collapse: collapse;
		margin: 16px 0 32px;
		font-size: 13px;
	}

	.report-table th,
	.report-table td {
		padding: 10px 12px;
		border: 1px solid #e2e8f0;
		text-align: left;
	}

	.report-table th {
		background: #f8fafc;
		font-weight: 700;
		color: #475569;
	}

	.tag {
		font-size: 11px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.tag.modified {
		background: #fef3c7;
		color: #b45309;
	}

	.tag.added {
		background: #dcfce7;
		color: #15803d;
	}

	.tag.removed {
		background: #fee2e2;
		color: #b91c1c;
	}

	.diff-new {
		background: #fef9c3;
		font-weight: 600;
	}

	.empty-table {
		text-align: center;
		color: #94a3b8;
		padding: 24px;
	}

	.pcb-stats-box {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 16px;
		display: flex;
		gap: 32px;
		font-size: 14px;
	}

	.report-footer-signatures {
		display: flex;
		justify-content: space-between;
		margin-top: 60px;
		padding-top: 24px;
		border-top: 1px solid #e2e8f0;
	}

	.sig-box {
		width: 40%;
		font-size: 13px;
		color: #475569;
		font-weight: 600;
	}

	.sig-line {
		border-bottom: 1px dashed #cbd5e1;
		height: 40px;
		margin-top: 8px;
	}

	@media print {
		.no-print {
			display: none !important;
		}

		.report-container {
			padding: 0;
			max-width: none;
		}

		.report-document {
			border: none;
			box-shadow: none;
			padding: 0;
		}
	}
</style>
