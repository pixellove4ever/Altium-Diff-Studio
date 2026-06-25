<script lang="ts">
  import type { AltiumDoc, AltiumSchDoc, AltiumPcbDoc, AltiumBomDoc } from '../types/altium';

  let { doc, title }: { doc: AltiumDoc; title: string } = $props();

  // Helper to extract unique columns from BOM
  const bomColumns = $derived.by(() => {
    if (doc.type !== 'bom') return [];
    const columns = new Set<string>();
    const bom = doc as AltiumBomDoc;
    bom.items.forEach((item) => {
      if (item.parameters) {
        Object.keys(item.parameters).forEach((k) => columns.add(k));
      }
    });
    return Array.from(columns);
  });
</script>

<div class="summary-card {doc.type}">
  <h4 class="summary-title">{title}</h4>

  <div class="summary-header">
    <span class="badge {doc.type}">{doc.type.toUpperCase()}</span>
    <span class="file-name" title={doc.fileName}>{doc.fileName}</span>
  </div>

  <div class="metrics-grid">
    {#if doc.type === 'schematic'}
      {@const sch = doc as AltiumSchDoc}
      <div class="metric-box">
        <span class="metric-val">{sch.components.length}</span>
        <span class="metric-lbl">Composants</span>
      </div>
      <div class="metric-box">
        <span class="metric-val">{sch.wires.length}</span>
        <span class="metric-lbl">Fils (Wires)</span>
      </div>
      <div class="metric-box">
        <span class="metric-val">{sch.netLabels.length}</span>
        <span class="metric-lbl">Équipotentielles</span>
      </div>
    {:else if doc.type === 'pcb'}
      {@const pcb = doc as AltiumPcbDoc}
      <div class="metric-box">
        <span class="metric-val">{pcb.components.length}</span>
        <span class="metric-lbl">Composants</span>
      </div>
      <div class="metric-box">
        <span class="metric-val">{pcb.tracks.length}</span>
        <span class="metric-lbl">Pistes</span>
      </div>
      <div class="metric-box">
        <span class="metric-val">{pcb.pads.length}</span>
        <span class="metric-lbl">Pastilles (Pads)</span>
      </div>
      <div class="metric-box">
        <span class="metric-val">{pcb.vias.length}</span>
        <span class="metric-lbl">Vias</span>
      </div>
    {:else if doc.type === 'bom'}
      {@const bom = doc as AltiumBomDoc}
      <div class="metric-box">
        <span class="metric-val">{bom.items.length}</span>
        <span class="metric-lbl">Lignes de BOM</span>
      </div>
      <div class="metric-box">
        <span class="metric-val">
          {bom.items.reduce((acc, curr) => acc + (curr.quantity || 1), 0)}
        </span>
        <span class="metric-lbl">Composants Totaux</span>
      </div>
    {/if}
  </div>

  {#if doc.type === 'pcb'}
    {@const pcb = doc as AltiumPcbDoc}
    {#if pcb.layers && pcb.layers.length > 0}
      <div class="extra-info">
        <span class="section-lbl">Couches de cuivre détectées :</span>
        <div class="layers-flex">
          {#each pcb.layers as layer}
            <span class="layer-pill">{layer}</span>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  {#if doc.type === 'bom' && bomColumns.length > 0}
    <div class="extra-info">
      <span class="section-lbl">Paramètres personnalisés détectés :</span>
      <div class="layers-flex">
        {#each bomColumns as col}
          <span class="param-pill">{col}</span>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .summary-card {
    background: rgba(30, 30, 45, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
    overflow: hidden;
  }

  .summary-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
  }

  .summary-card.pcb::before {
    background: #10b981;
  }

  .summary-card.schematic::before {
    background: #f59e0b;
  }

  .summary-card.bom::before {
    background: #3b82f6;
  }

  .summary-title {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.4);
    margin: 0;
  }

  .summary-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .badge {
    font-size: 0.7rem;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 6px;
    color: white;
    letter-spacing: 0.05em;
  }

  .badge.pcb {
    background: rgba(16, 185, 129, 0.2);
    border: 1px solid rgba(16, 185, 129, 0.4);
    color: #34d399;
  }

  .badge.schematic {
    background: rgba(245, 158, 11, 0.2);
    border: 1px solid rgba(245, 158, 11, 0.4);
    color: #fbbf24;
  }

  .badge.bom {
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.4);
    color: #60a5fa;
  }

  .file-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 12px;
  }

  .metric-box {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
    padding: 12px;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .metric-box:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.08);
    transform: translateY(-2px);
  }

  .metric-val {
    font-size: 1.4rem;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.2;
  }

  .metric-lbl {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    margin-top: 4px;
  }

  .extra-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    padding-top: 12px;
  }

  .section-lbl {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    font-weight: 500;
  }

  .layers-flex {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .layer-pill,
  .param-pill {
    font-size: 0.7rem;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .layer-pill {
    color: #34d399;
  }

  .param-pill {
    color: #60a5fa;
  }
</style>
