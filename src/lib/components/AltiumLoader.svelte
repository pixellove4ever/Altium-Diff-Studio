<script lang="ts">
  import { diffState } from '../state/diffState.svelte';
  import type { AltiumDoc } from '../types/altium';

  let { side, label }: { side: 'A' | 'B'; label: string } = $props();

  let isDragging = $state(false);
  let uploadError = $state<string | null>(null);

  const file = $derived(side === 'A' ? diffState.fileA : diffState.fileB);

  function validateAltiumJson(data: any): AltiumDoc {
    if (typeof data !== 'object' || data === null) {
      throw new Error("Le fichier n'est pas un objet JSON valide.");
    }
    if (!data.type) {
      throw new Error("Propriété 'type' manquante dans le fichier JSON.");
    }

    if (data.type === 'schematic') {
      if (!Array.isArray(data.components) || !Array.isArray(data.wires)) {
        throw new Error("Format Schématique invalide : tableaux 'components' ou 'wires' manquants.");
      }
      return data as AltiumDoc;
    } else if (data.type === 'pcb') {
      if (!Array.isArray(data.components) || !Array.isArray(data.tracks) || !Array.isArray(data.pads)) {
        throw new Error("Format PCB invalide : tableaux 'components', 'tracks' ou 'pads' manquants.");
      }
      return data as AltiumDoc;
    } else if (data.type === 'bom') {
      if (!Array.isArray(data.items)) {
        throw new Error("Format BOM invalide : tableau 'items' manquant.");
      }
      return data as AltiumDoc;
    } else {
      throw new Error(`Type de document Altium inconnu : '${data.type}'. Les types supportés sont 'schematic', 'pcb', et 'bom'.`);
    }
  }

  function handleFile(selectedFile: File) {
    uploadError = null;
    if (selectedFile.type !== 'application/json' && !selectedFile.name.endsWith('.json')) {
      uploadError = 'Le fichier doit être au format JSON (.json).';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        const validated = validateAltiumJson(parsed);

        // Add file metadata
        validated.fileName = selectedFile.name;
        validated.fileSize = selectedFile.size;

        if (side === 'A') {
          diffState.setFileA(validated);
        } else {
          diffState.setFileB(validated);
        }
      } catch (err: any) {
        uploadError = err.message || 'Erreur lors de la lecture du fichier.';
      }
    };
    reader.onerror = () => {
      uploadError = 'Impossible de lire le fichier.';
    };
    reader.readAsText(selectedFile);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  function handleFileInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleFile(target.files[0]);
    }
  }

  function removeFile() {
    if (side === 'A') {
      diffState.setFileA(null);
    } else {
      diffState.setFileB(null);
    }
    uploadError = null;
  }

  function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
</script>

<div class="loader-card {isDragging ? 'dragging' : ''} {file ? 'loaded' : ''}">
  <h3 class="side-title">{label}</h3>

  {#if file}
    <div class="file-details">
      <div class="file-icon-wrapper">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="file-icon">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="file-badge {file.type}">{file.type.toUpperCase()}</span>
      </div>
      <div class="file-info">
        <span class="file-name" title={file.fileName}>{file.fileName}</span>
        <span class="file-size">{formatSize(file.fileSize)}</span>
      </div>
      <button onclick={removeFile} class="btn-remove" aria-label="Supprimer le fichier">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="close-icon">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="drop-zone"
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
    >
      <input
        type="file"
        id="file-input-{side}"
        accept=".json"
        onchange={handleFileInput}
        class="hidden-input"
      />
      <label for="file-input-{side}" class="drop-label">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="upload-icon">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span class="upload-text">Glissez-déposez votre JSON Altium ici ou</span>
        <span class="btn-browse">Parcourir les fichiers</span>
      </label>
    </div>
  {/if}

  {#if uploadError}
    <div class="error-msg">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="error-icon">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>{uploadError}</span>
    </div>
  {/if}
</div>

<style>
  .loader-card {
    background: rgba(30, 30, 40, 0.6);
    border: 1px dashed rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    padding: 24px;
    backdrop-filter: blur(12px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 200px;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }

  .loader-card.dragging {
    border-color: #6366f1;
    background: rgba(99, 102, 241, 0.1);
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.2);
  }

  .loader-card.loaded {
    border-style: solid;
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(30, 30, 40, 0.85);
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  }

  .side-title {
    font-size: 0.9rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
    position: absolute;
    top: 16px;
    left: 20px;
  }

  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    margin-top: 16px;
    cursor: pointer;
  }

  .hidden-input {
    display: none;
  }

  .drop-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    width: 100%;
    padding: 20px 0;
  }

  .upload-icon {
    width: 40px;
    height: 40px;
    color: #6366f1;
    transition: transform 0.3s ease;
  }

  .drop-zone:hover .upload-icon {
    transform: translateY(-4px);
  }

  .upload-text {
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.7);
    text-align: center;
  }

  .btn-browse {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ffffff;
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
    padding: 8px 18px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    transition: all 0.2s ease;
  }

  .drop-zone:hover .btn-browse {
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
  }

  .file-details {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 16px;
    border-radius: 12px;
    position: relative;
    width: 100%;
    box-sizing: border-box;
  }

  .file-icon-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .file-icon {
    width: 44px;
    height: 44px;
    color: rgba(255, 255, 255, 0.6);
  }

  .file-badge {
    position: absolute;
    bottom: -6px;
    right: -6px;
    font-size: 0.65rem;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    color: white;
  }

  .file-badge.pcb {
    background: #10b981;
  }

  .file-badge.schematic {
    background: #f59e0b;
  }

  .file-badge.bom {
    background: #3b82f6;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-grow: 1;
    min-width: 0;
  }

  .file-name {
    font-size: 0.95rem;
    font-weight: 500;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-size {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.4);
  }

  .btn-remove {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.4);
    padding: 8px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .btn-remove:hover {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .close-icon {
    width: 18px;
    height: 18px;
  }

  .error-msg {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    padding: 10px 14px;
    border-radius: 8px;
    color: #fca5a5;
    font-size: 0.85rem;
  }

  .error-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
</style>
