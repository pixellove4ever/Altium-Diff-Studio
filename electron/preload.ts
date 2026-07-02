import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
	getFilePath: (file: File): string => webUtils.getPathForFile(file),
	findPdfNearJson: (
		filePaths: string[]
	): Promise<{ name: string; path: string; size: number; data: Uint8Array } | null> =>
		ipcRenderer.invoke('pdf:find-near-json', filePaths),
	findDxfNearJson: (
		filePaths: string[]
	): Promise<Array<{ name: string; path: string; size: number; data: Uint8Array }>> =>
		ipcRenderer.invoke('dxf:find-near-json', filePaths)
};

contextBridge.exposeInMainWorld('altiumDiff', api);

export type AltiumDiffApi = typeof api;
