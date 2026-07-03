import { contextBridge, ipcRenderer, webUtils } from 'electron';

export type AppCommand =
	| 'new-workspace'
	| 'open-a'
	| 'open-b'
	| 'command-palette'
	| 'toggle-tools'
	| 'toggle-inspector'
	| 'show-help'
	| 'open-pcb'
	| 'open-schematic'
	| 'open-bom';

const api = {
	getFilePath: (file: File): string => webUtils.getPathForFile(file),
	findPdfNearJson: (
		filePaths: string[]
	): Promise<{ name: string; path: string; size: number; data: Uint8Array } | null> =>
		ipcRenderer.invoke('pdf:find-near-json', filePaths),
	findDxfNearJson: (
		filePaths: string[]
	): Promise<Array<{ name: string; path: string; size: number; data: Uint8Array }>> =>
		ipcRenderer.invoke('dxf:find-near-json', filePaths),
	chooseProjectFiles: (): Promise<
		Array<{ name: string; path: string; size: number; data: Uint8Array }>
	> => ipcRenderer.invoke('files:choose-project'),
	onCommand: (callback: (command: AppCommand) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, command: AppCommand) => callback(command);
		ipcRenderer.on('app:command', listener);
		return () => ipcRenderer.removeListener('app:command', listener);
	}
};

contextBridge.exposeInMainWorld('altiumDiff', api);

export type AltiumDiffApi = typeof api;
