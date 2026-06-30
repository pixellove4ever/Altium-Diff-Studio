import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';

const isDev = !!process.env.ELECTRON_RENDERER_URL;

function createWindow() {
	const mainWindow = new BrowserWindow({
		width: 1440,
		height: 960,
		minWidth: 1100,
		minHeight: 720,
		title: 'Altium Diff Studio',
		backgroundColor: '#f7f8fb',
		show: false,
		webPreferences: {
			preload: join(__dirname, '../preload/preload.mjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		}
	});

	mainWindow.once('ready-to-show', () => {
		mainWindow.show();
	});

	if (isDev && process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
		mainWindow.webContents.openDevTools({ mode: 'detach' });
	} else {
		mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
	}
}

app.whenReady().then(() => {
	ipcMain.handle('dialog:open-json-files', async () => {
		const result = await dialog.showOpenDialog({
			title: 'Select Altium JSON exports',
			properties: ['openFile', 'multiSelections'],
			filters: [{ name: 'Altium JSON exports', extensions: ['json'] }]
		});

		return result.canceled ? [] : result.filePaths;
	});

	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
