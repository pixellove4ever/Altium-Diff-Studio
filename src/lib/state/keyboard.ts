import { projectStore, type WorkspaceTab } from '$lib/state/projectStore.svelte';
import { viewerStore } from '$lib/state/viewerStore.svelte';
import { localeStore } from '$lib/state/localeStore.svelte';
import type { AppCommand } from '../../../electron/preload';

export interface KeyboardActions {
	toggleCommandPalette: () => void;
	closeCommandPalette: () => void;
	isCommandPaletteOpen: () => boolean;
	openHelp: () => void;
	closeHelp: () => void;
	isHelpOpen: () => boolean;
	returnHome: () => void;
	openNativeFiles: (side: 'A' | 'B') => Promise<void>;
}

export function setupKeyboardShortcuts(actions: KeyboardActions) {
	const onKeyDown = (event: KeyboardEvent) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			actions.toggleCommandPalette();
			return;
		}
		if (event.key === 'Escape' && actions.isCommandPaletteOpen()) {
			actions.closeCommandPalette();
			return;
		}
		if (event.key === 'Escape' && actions.isHelpOpen()) {
			actions.closeHelp();
			return;
		}
		if (event.key === 'F1') {
			event.preventDefault();
			actions.openHelp();
			return;
		}
		if (!event.altKey || !projectStore.isReady) return;
		const tab =
			event.key === '1'
				? 'pcb'
				: event.key === '2'
					? 'schematic'
					: event.key === '3'
						? 'bom'
						: null;
		if (tab && projectStore.availableTabs.includes(tab as WorkspaceTab)) {
			event.preventDefault();
			projectStore.activeTab = tab as WorkspaceTab;
		}
	};

	const handleCommand = (command: AppCommand) => {
		if (command === 'new-workspace') actions.returnHome();
		else if (command === 'open-a') void actions.openNativeFiles('A');
		else if (command === 'open-b') void actions.openNativeFiles('B');
		else if (command === 'command-palette') {
			if (!actions.isCommandPaletteOpen()) actions.toggleCommandPalette();
		}
		else if (command === 'show-help') actions.openHelp();
		else if (command === 'toggle-tools') viewerStore.toggleMinimalUi();
		else if (command === 'set-locale-fr') localeStore.set('fr');
		else if (command === 'set-locale-en') localeStore.set('en');
		else {
			const tab =
				command === 'open-pcb'
					? 'pcb'
					: command === 'open-schematic'
						? 'schematic'
						: command === 'open-bom'
							? 'bom'
							: null;
			if (tab && projectStore.availableTabs.includes(tab)) projectStore.activeTab = tab;
		}
	};

	window.addEventListener('keydown', onKeyDown);
	const removeCommandListener = window.altiumDiff?.onCommand(handleCommand);

	return () => {
		window.removeEventListener('keydown', onKeyDown);
		removeCommandListener?.();
	};
}
