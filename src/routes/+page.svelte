<script lang="ts">
  import AltiumLoader from '$lib/components/AltiumLoader.svelte';
  import SummaryViewer from '$lib/components/SummaryViewer.svelte';
  import { diffState } from '$lib/state/diffState.svelte';

  let searchQuery = $state('');
  let activeFilter = $state<'all' | 'added' | 'removed' | 'modified'>('all');

  const diff = $derived(diffState.activeDiff);
  const isLoaded = $derived(diffState.fileA && diffState.fileB && !diffState.error);

  // Filtered diff results
  const filteredAdded = $derived.by(() => {
    if (!diff) return [];
    return diff.added.filter((d) => d.toLowerCase().includes(searchQuery.toLowerCase()));
  });

  const filteredRemoved = $derived.by(() => {
    if (!diff) return [];
    return diff.removed.filter((d) => d.toLowerCase().includes(searchQuery.toLowerCase()));
  });

  const filteredModified = $derived.by(() => {
    if (!diff) return [];
    return diff.modified.filter(
      (m) =>
        m.designator.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.changes.some(
          (c) =>
            c.field.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.to.toLowerCase().includes(searchQuery.toLowerCase())
        )
    );
  });

  const totalDiffCount = $derived(
    (diff?.added.length || 0) + (diff?.removed.length || 0) + (diff?.modified.length || 0)
  );

  function resetAll() {
    diffState.reset();
    searchQuery = '';
    activeFilter = 'all';
  }
</script>

<div class="dashboard">
  {#if !isLoaded}
    <section class="welcome-section">
      <h2 class="welcome-title">Comparez vos fichiers Altium</h2>
      <p class="welcome-subtitle">
        Importez deux fichiers exportés au format JSON (Original & Modifié) pour analyser
        instantanément les différences de composants, pistes ou lignes de nomenclature (BOM).
      </p>
    </section>
  {/if}

  <!-- Loading grid -->
  <div class="loader-grid">
    <AltiumLoader side="A" label="Fichier A (Original)" />
    <AltiumLoader side="B" label="Fichier B (Modifié)" />
  </div>

  {#if diffState.error}
    <div class="error-container">
      <svg
        class="error-icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>{diffState.error}</span>
    </div>
  {/if}

  {#if isLoaded && diffState.fileA && diffState.fileB}
    <!-- Summaries -->
    <div class="summaries-grid">
      <SummaryViewer doc={diffState.fileA} title="Détails - Fichier Original A" />
      <SummaryViewer doc={diffState.fileB} title="Détails - Fichier Modifié B" />
    </div>

    <!-- Difference Results Section -->
    <section class="diff-section">
      <div class="diff-header">
        <div class="diff-title-area">
          <h3 class="diff-section-title">Analyse des Différences</h3>
          <span class="diff-count-badge">
            {#if totalDiffCount === 0}
              Aucune différence détectée
            {:else if totalDiffCount === 1}
              1 différence détectée
            {:else}
              {totalDiffCount} différences détectées
            {/if}
          </span>
        </div>
        <button onclick={resetAll} class="btn-reset-all"> Réinitialiser la comparaison </button>
      </div>

      {#if totalDiffCount > 0}
        <!-- Filters and search -->
        <div class="controls-row">
          <div class="filter-tabs">
            <button
              onclick={() => (activeFilter = 'all')}
              class="tab-btn {activeFilter === 'all' ? 'active' : ''}"
            >
              Tout ({totalDiffCount})
            </button>
            <button
              onclick={() => (activeFilter = 'added')}
              class="tab-btn added {activeFilter === 'added' ? 'active' : ''}"
            >
              Ajoutés ({diff?.added.length || 0})
            </button>
            <button
              onclick={() => (activeFilter = 'removed')}
              class="tab-btn removed {activeFilter === 'removed' ? 'active' : ''}"
            >
              Supprimés ({diff?.removed.length || 0})
            </button>
            <button
              onclick={() => (activeFilter = 'modified')}
              class="tab-btn modified {activeFilter === 'modified' ? 'active' : ''}"
            >
              Modifiés ({diff?.modified.length || 0})
            </button>
          </div>

          <div class="search-wrapper">
            <svg
              class="search-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder="Rechercher un composant (ex. R12, C4)..."
              bind:value={searchQuery}
              class="search-input"
            />
          </div>
        </div>

        <!-- Results Grid -->
        <div class="results-list">
          <!-- Added items -->
          {#if activeFilter === 'all' || activeFilter === 'added'}
            {#each filteredAdded as des}
              <div class="diff-card added">
                <div class="card-left">
                  <span class="status-indicator">AJOUTÉ</span>
                  <h4 class="designator">{des}</h4>
                </div>
                <div class="card-right">
                  <span class="desc-text"
                    >Le composant est présent dans la version modifiée mais manquant dans
                    l'originale.</span
                  >
                </div>
              </div>
            {/each}
          {/if}

          <!-- Removed items -->
          {#if activeFilter === 'all' || activeFilter === 'removed'}
            {#each filteredRemoved as des}
              <div class="diff-card removed">
                <div class="card-left">
                  <span class="status-indicator">SUPPRIMÉ</span>
                  <h4 class="designator">{des}</h4>
                </div>
                <div class="card-right">
                  <span class="desc-text"
                    >Le composant est présent dans l'original mais a été retiré dans la version
                    modifiée.</span
                  >
                </div>
              </div>
            {/each}
          {/if}

          <!-- Modified items -->
          {#if activeFilter === 'all' || activeFilter === 'modified'}
            {#each filteredModified as mod}
              <div class="diff-card modified">
                <div class="card-left">
                  <span class="status-indicator">MODIFIÉ</span>
                  <h4 class="designator">{mod.designator}</h4>
                </div>
                <div class="card-right">
                  <table class="changes-table">
                    <thead>
                      <tr>
                        <th>Propriété</th>
                        <th>Original</th>
                        <th>Modifié</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each mod.changes as chg}
                        <tr>
                          <td class="prop-name">{chg.field}</td>
                          <td class="prop-from">{chg.from}</td>
                          <td class="prop-to">{chg.to}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/each}
          {/if}

          {#if activeFilter === 'all' && filteredAdded.length === 0 && filteredRemoved.length === 0 && filteredModified.length === 0}
            <div class="empty-search">
              <span>Aucun composant ne correspond à votre recherche.</span>
            </div>
          {/if}
        </div>
      {:else}
        <div class="no-diffs">
          <svg
            class="success-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <h4>Parfaitement identiques !</h4>
          <p>Aucune différence n'a été détectée entre le fichier original et le fichier modifié.</p>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .welcome-section {
    text-align: center;
    max-width: 700px;
    margin: 20px auto 10px;
  }

  .welcome-title {
    font-size: 2.2rem;
    font-weight: 800;
    color: #ffffff;
    margin: 0 0 12px;
    letter-spacing: -0.03em;
  }

  .welcome-subtitle {
    font-size: 1.05rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.55);
  }

  .loader-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 24px;
  }

  .error-container {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    padding: 16px 20px;
    border-radius: 12px;
    color: #fca5a5;
    font-weight: 500;
  }

  .error-icon {
    width: 20px;
    height: 20px;
    color: #ef4444;
    flex-shrink: 0;
  }

  .summaries-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 24px;
  }

  .diff-section {
    background: rgba(20, 20, 28, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 30px;
    backdrop-filter: blur(16px);
    display: flex;
    flex-direction: column;
    gap: 24px;
    animation: fadeIn 0.4s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .diff-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding-bottom: 20px;
  }

  .diff-title-area {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .diff-section-title {
    font-size: 1.4rem;
    font-weight: 700;
    margin: 0;
    color: #ffffff;
  }

  .diff-count-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 9999px;
    background: rgba(99, 102, 241, 0.1);
    border: 1px solid rgba(99, 102, 241, 0.2);
    color: #818cf8;
  }

  .btn-reset-all {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    transition: all 0.2s ease;
  }

  .btn-reset-all:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .controls-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }

  .filter-tabs {
    display: flex;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 4px;
    border-radius: 10px;
    gap: 4px;
  }

  .tab-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.5);
    font-weight: 600;
    font-size: 0.85rem;
    padding: 8px 16px;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  .tab-btn:hover {
    color: #ffffff;
  }

  .tab-btn.active {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .tab-btn.added.active {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
  }

  .tab-btn.removed.active {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }

  .tab-btn.modified.active {
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
  }

  .search-wrapper {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 0 14px;
    border-radius: 10px;
    gap: 10px;
    width: 320px;
    transition: all 0.2s ease;
  }

  .search-wrapper:focus-within {
    border-color: #6366f1;
    background: rgba(255, 255, 255, 0.05);
    box-shadow: 0 0 12px rgba(99, 102, 241, 0.15);
  }

  .search-icon {
    width: 16px;
    height: 16px;
    color: rgba(255, 255, 255, 0.4);
  }

  .search-input {
    background: none;
    border: none;
    color: #ffffff;
    font-size: 0.85rem;
    padding: 10px 0;
    width: 100%;
    outline: none;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .results-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .diff-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 18px 24px;
    display: flex;
    align-items: center;
    gap: 24px;
    transition: all 0.2s ease;
  }

  .diff-card:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.08);
    transform: translateX(4px);
  }

  .card-left {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 130px;
    flex-shrink: 0;
  }

  .status-indicator {
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 4px;
    width: fit-content;
  }

  .added .status-indicator {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
  }

  .removed .status-indicator {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }

  .modified .status-indicator {
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
  }

  .designator {
    font-size: 1.15rem;
    font-weight: 700;
    color: #ffffff;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .card-right {
    flex-grow: 1;
    min-width: 0;
  }

  .desc-text {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .changes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .changes-table th {
    text-align: left;
    color: rgba(255, 255, 255, 0.4);
    font-weight: 500;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .changes-table td {
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.02);
  }

  .changes-table tr:last-child td {
    border-bottom: none;
    padding-bottom: 0;
  }

  .prop-name {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    width: 25%;
  }

  .prop-from {
    color: #f87171;
    text-decoration: line-through;
    width: 35%;
  }

  .prop-to {
    color: #34d399;
    font-weight: 500;
    width: 40%;
  }

  .no-diffs {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.55);
  }

  .success-icon {
    width: 48px;
    height: 48px;
    color: #10b981;
    margin-bottom: 16px;
  }

  .no-diffs h4 {
    color: #ffffff;
    font-size: 1.15rem;
    margin: 0 0 8px;
  }

  .no-diffs p {
    font-size: 0.9rem;
    margin: 0;
  }

  .empty-search {
    text-align: center;
    padding: 30px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.9rem;
  }
</style>
