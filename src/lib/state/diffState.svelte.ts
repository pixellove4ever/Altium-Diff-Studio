import type { AltiumDoc, AltiumSchDoc, AltiumPcbDoc, AltiumBomDoc } from '../types/altium';

export interface DiffResult {
  added: string[];
  removed: string[];
  modified: Array<{
    designator: string;
    changes: Array<{ field: string; from: string; to: string }>;
  }>;
}

class DiffState {
  fileA = $state<AltiumDoc | null>(null);
  fileB = $state<AltiumDoc | null>(null);
  error = $state<string | null>(null);

  // Derived type of document currently being worked on
  type = $derived.by(() => {
    if (this.fileA && this.fileB) {
      if (this.fileA.type === this.fileB.type) {
        return this.fileA.type;
      }
      return null; // Mismatch
    }
    return this.fileA?.type || this.fileB?.type || null;
  });

  // Reactive type mismatch indicator
  typeMismatch = $derived.by(() => {
    return !!(this.fileA && this.fileB && this.fileA.type !== this.fileB.type);
  });

  // Reactive diff calculator for BOM
  bomDiff = $derived.by<DiffResult | null>(() => {
    if (this.type !== 'bom' || !this.fileA || !this.fileB) return null;
    const docA = this.fileA as AltiumBomDoc;
    const docB = this.fileB as AltiumBomDoc;

    const mapA = new Map(docA.items.map((i) => [i.designator, i]));
    const mapB = new Map(docB.items.map((i) => [i.designator, i]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: DiffResult['modified'] = [];

    // Check B against A (Additions and Modifications)
    for (const [des, itemB] of mapB) {
      const itemA = mapA.get(des);
      if (!itemA) {
        added.push(des);
      } else {
        const changes: Array<{ field: string; from: string; to: string }> = [];
        if (itemA.comment !== itemB.comment) {
          changes.push({ field: 'Comment', from: itemA.comment, to: itemB.comment });
        }
        if (itemA.footprint !== itemB.footprint) {
          changes.push({ field: 'Footprint', from: itemA.footprint, to: itemB.footprint });
        }
        if (itemA.description !== itemB.description) {
          changes.push({ field: 'Description', from: itemA.description || '', to: itemB.description || '' });
        }
        if (itemA.libRef !== itemB.libRef) {
          changes.push({ field: 'Library Reference', from: itemA.libRef || '', to: itemB.libRef || '' });
        }
        if (itemA.quantity !== itemB.quantity) {
          changes.push({ field: 'Quantity', from: String(itemA.quantity || 0), to: String(itemB.quantity || 0) });
        }

        // Compare parameters
        const paramsA = itemA.parameters || {};
        const paramsB = itemB.parameters || {};
        const allKeys = new Set([...Object.keys(paramsA), ...Object.keys(paramsB)]);

        for (const key of allKeys) {
          if (paramsA[key] !== paramsB[key]) {
            changes.push({
              field: `Param: ${key}`,
              from: paramsA[key] || '(missing)',
              to: paramsB[key] || '(missing)'
            });
          }
        }

        if (changes.length > 0) {
          modified.push({ designator: des, changes });
        }
      }
    }

    // Check A against B (Removals)
    for (const des of mapA.keys()) {
      if (!mapB.has(des)) {
        removed.push(des);
      }
    }

    return {
      added: added.sort(),
      removed: removed.sort(),
      modified: modified.sort((a, b) => a.designator.localeCompare(b.designator))
    };
  });

  // Reactive diff calculator for PCB
  pcbDiff = $derived.by<DiffResult | null>(() => {
    if (this.type !== 'pcb' || !this.fileA || !this.fileB) return null;
    const docA = this.fileA as AltiumPcbDoc;
    const docB = this.fileB as AltiumPcbDoc;

    const mapA = new Map(docA.components.map((c) => [c.designator, c]));
    const mapB = new Map(docB.components.map((c) => [c.designator, c]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: DiffResult['modified'] = [];

    // Check components
    for (const [des, compB] of mapB) {
      const compA = mapA.get(des);
      if (!compA) {
        added.push(des);
      } else {
        const changes: Array<{ field: string; from: string; to: string }> = [];
        if (compA.comment !== compB.comment) {
          changes.push({ field: 'Comment', from: compA.comment, to: compB.comment });
        }
        if (compA.footprint !== compB.footprint) {
          changes.push({ field: 'Footprint', from: compA.footprint, to: compB.footprint });
        }
        if (compA.layer !== compB.layer) {
          changes.push({ field: 'Layer', from: compA.layer, to: compB.layer });
        }
        if (compA.x !== compB.x || compA.y !== compB.y) {
          changes.push({ field: 'Position', from: `(${compA.x}, ${compA.y})`, to: `(${compB.x}, ${compB.y})` });
        }
        if (compA.rotation !== compB.rotation) {
          changes.push({ field: 'Rotation', from: `${compA.rotation}°`, to: `${compB.rotation}°` });
        }

        if (changes.length > 0) {
          modified.push({ designator: des, changes });
        }
      }
    }

    for (const des of mapA.keys()) {
      if (!mapB.has(des)) {
        removed.push(des);
      }
    }

    return {
      added: added.sort(),
      removed: removed.sort(),
      modified: modified.sort((a, b) => a.designator.localeCompare(b.designator))
    };
  });

  // Reactive diff calculator for Schematics
  schDiff = $derived.by<DiffResult | null>(() => {
    if (this.type !== 'schematic' || !this.fileA || !this.fileB) return null;
    const docA = this.fileA as AltiumSchDoc;
    const docB = this.fileB as AltiumSchDoc;

    const mapA = new Map(docA.components.map((c) => [c.designator, c]));
    const mapB = new Map(docB.components.map((c) => [c.designator, c]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: DiffResult['modified'] = [];

    // Check components
    for (const [des, compB] of mapB) {
      const compA = mapA.get(des);
      if (!compA) {
        added.push(des);
      } else {
        const changes: Array<{ field: string; from: string; to: string }> = [];
        if (compA.comment !== compB.comment) {
          changes.push({ field: 'Comment', from: compA.comment, to: compB.comment });
        }
        if (compA.libRef !== compB.libRef) {
          changes.push({ field: 'Library Ref', from: compA.libRef, to: compB.libRef });
        }
        if (compA.x !== compB.x || compA.y !== compB.y) {
          changes.push({ field: 'Position', from: `(${compA.x}, ${compA.y})`, to: `(${compB.x}, ${compB.y})` });
        }

        if (changes.length > 0) {
          modified.push({ designator: des, changes });
        }
      }
    }

    for (const des of mapA.keys()) {
      if (!mapB.has(des)) {
        removed.push(des);
      }
    }

    return {
      added: added.sort(),
      removed: removed.sort(),
      modified: modified.sort((a, b) => a.designator.localeCompare(b.designator))
    };
  });

  // Overall diff summary
  activeDiff = $derived.by<DiffResult | null>(() => {
    if (this.type === 'bom') return this.bomDiff;
    if (this.type === 'pcb') return this.pcbDiff;
    if (this.type === 'schematic') return this.schDiff;
    return null;
  });

  setFileA(doc: AltiumDoc | null) {
    this.fileA = doc;
    this.validateTypes();
  }

  setFileB(doc: AltiumDoc | null) {
    this.fileB = doc;
    this.validateTypes();
  }

  validateTypes() {
    if (this.fileA && this.fileB && this.fileA.type !== this.fileB.type) {
      this.error = `Incompatibilité : Impossible de comparer un document ${this.fileA.type.toUpperCase()} avec un document ${this.fileB.type.toUpperCase()}.`;
    } else {
      this.error = null;
    }
  }

  reset() {
    this.fileA = null;
    this.fileB = null;
    this.error = null;
  }
}

export const diffState = new DiffState();
