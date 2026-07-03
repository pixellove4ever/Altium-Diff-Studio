import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions
} from 'electron';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

const isDev = !!process.env.ELECTRON_RENDERER_URL;

type AppCommand =
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

function installApplicationMenu(mainWindow: BrowserWindow) {
	const send = (command: AppCommand) => mainWindow.webContents.send('app:command', command);
	const template: MenuItemConstructorOptions[] = [
		{
			label: 'File',
			submenu: [
				{ label: 'New workspace', accelerator: 'CmdOrCtrl+N', click: () => send('new-workspace') },
				{ type: 'separator' },
				{
					label: 'Open project / version A…',
					accelerator: 'CmdOrCtrl+O',
					click: () => send('open-a')
				},
				{
					label: 'Open version B…',
					accelerator: 'CmdOrCtrl+Shift+O',
					click: () => send('open-b')
				},
				{ type: 'separator' },
				{ role: process.platform === 'darwin' ? 'close' : 'quit' }
			]
		},
		{
			label: 'Navigate',
			submenu: [
				{
					label: 'Command palette',
					accelerator: 'CmdOrCtrl+K',
					click: () => send('command-palette')
				},
				{ type: 'separator' },
				{ label: 'PCB', accelerator: 'Alt+1', click: () => send('open-pcb') },
				{ label: 'Schematic', accelerator: 'Alt+2', click: () => send('open-schematic') },
				{ label: 'BOM', accelerator: 'Alt+3', click: () => send('open-bom') }
			]
		},
		{
			label: 'View',
			submenu: [
				{
					label: 'Show / hide tools',
					accelerator: 'CmdOrCtrl+.',
					click: () => send('toggle-tools')
				},
				{
					label: 'Show / hide inspector',
					accelerator: 'CmdOrCtrl+Shift+F',
					click: () => send('toggle-inspector')
				},
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ role: 'togglefullscreen' }
			]
		},
		{
			label: 'Help',
			submenu: [
				{ label: 'Help & keyboard shortcuts', accelerator: 'F1', click: () => send('show-help') },
				{ type: 'separator' },
				{ role: 'about' },
				...(isDev
					? ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
					: [])
			]
		}
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
	installApplicationMenu(mainWindow);

	if (isDev && process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
		mainWindow.webContents.openDevTools({ mode: 'detach' });
	} else {
		mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
	}
}

app.whenReady().then(() => {
	app.setName('Altium Diff Studio');
	ipcMain.handle('files:choose-project', async () => {
		const result = await dialog.showOpenDialog({
			title: 'Open Altium Diff Studio exports',
			properties: ['openFile', 'multiSelections'],
			filters: [
				{ name: 'Altium review files', extensions: ['json', 'pdf', 'dxf'] },
				{ name: 'All files', extensions: ['*'] }
			]
		});
		if (result.canceled) return [];
		return Promise.all(
			result.filePaths.map(async (path) => {
				const details = await stat(path);
				return {
					name: basename(path),
					path,
					size: details.size,
					data: new Uint8Array(await readFile(path))
				};
			})
		);
	});
	ipcMain.handle('pdf:find-near-json', async (_event, filePaths: string[]) => {
		const jsonPaths = filePaths.filter((filePath) => extname(filePath).toLowerCase() === '.json');
		const prefixes = jsonPaths.map((filePath) =>
			basename(filePath, extname(filePath))
				.replace(/_(bom|pcb|schematic|ads_manifest)$/i, '')
				.toLowerCase()
		);
		const directories = Array.from(new Set(jsonPaths.map((filePath) => dirname(filePath))));
		const candidates: Array<{
			path: string;
			name: string;
			size: number;
			mtimeMs: number;
			score: number;
		}> = [];
		for (const directory of directories) {
			for (const name of await readdir(directory)) {
				if (extname(name).toLowerCase() !== '.pdf') continue;
				const path = join(directory, name);
				const details = await stat(path);
				const stem = basename(name, '.pdf').toLowerCase();
				const prefixScore = prefixes.some((prefix) => prefix && stem.startsWith(prefix)) ? 100 : 0;
				const semanticScore = /(smart|schematic|schema|sch)/i.test(stem) ? 20 : 0;
				candidates.push({
					path,
					name,
					size: details.size,
					mtimeMs: details.mtimeMs,
					score: prefixScore + semanticScore
				});
			}
		}
		const eligible =
			candidates.length === 1 ? candidates : candidates.filter((candidate) => candidate.score > 0);
		const selected = eligible.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs)[0];
		if (!selected) return null;
		const data = await readFile(selected.path);
		return {
			name: selected.name,
			path: selected.path,
			size: selected.size,
			data: new Uint8Array(data)
		};
	});

	ipcMain.handle('dxf:find-near-json', async (_event, filePaths: string[]) => {
		const jsonPaths = filePaths.filter((filePath) => extname(filePath).toLowerCase() === '.json');
		const directories = Array.from(new Set(jsonPaths.map((filePath) => dirname(filePath))));
		const paths = new Set<string>();

		for (const directory of directories) {
			const entries = await readdir(directory, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isFile() && extname(entry.name).toLowerCase() === '.dxf') {
					paths.add(join(directory, entry.name));
				}
				if (entry.isDirectory() && /(dxf|schematic|schema|outputs?)/i.test(entry.name)) {
					const childDirectory = join(directory, entry.name);
					for (const child of await readdir(childDirectory, { withFileTypes: true })) {
						if (child.isFile() && extname(child.name).toLowerCase() === '.dxf') {
							paths.add(join(childDirectory, child.name));
						}
					}
				}
			}
		}

		const candidates = await Promise.all(
			Array.from(paths).map(async (path) => {
				const name = basename(path);
				const details = await stat(path);
				return { path, name, size: details.size };
			})
		);
		return Promise.all(
			candidates
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(async (candidate) => ({
					name: candidate.name,
					path: candidate.path,
					size: candidate.size,
					data: new Uint8Array(await readFile(candidate.path))
				}))
		);
	});

	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
