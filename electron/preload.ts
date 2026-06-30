import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
	openJsonFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:open-json-files'),
	getFilePath: (file: File): string => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld('altiumDiff', api);

export type AltiumDiffApi = typeof api;
