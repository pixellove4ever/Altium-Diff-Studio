import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions
} from 'electron';
import { readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { resolveLocale, translate } from '../src/lib/i18n';

const isDev = !!process.env.ELECTRON_RENDERER_URL;
const appDirectory = import.meta.dirname;

type AppCommand =
	| 'new-workspace'
	| 'open-a'
	| 'open-b'
	| 'command-palette'
	| 'toggle-tools'
	| 'show-help'
	| 'set-locale-fr'
	| 'set-locale-en'
	| 'open-pcb'
	| 'open-schematic'
	| 'open-bom';

const projectFileExtensions = new Set([
	'.json',
	'.pdf',
	'.dxf',
	'.gbr',
	'.ger',
	'.pho',
	'.art',
	'.gtl',
	'.gbl',
	'.gts',
	'.gbs',
	'.gtp',
	'.gbp',
	'.gto',
	'.gbo',
	'.gm1',
	'.gm2',
	'.gko',
	'.gml',
	'.drl',
	'.xln',
	'.odb',
	'.odb++',
	'.tgz',
	'.tar',
	'.gz',
	'.zip'
]);

async function collectProjectFiles(paths: string[]) {
	const collected: string[] = [];
	const visit = async (path: string) => {
		const details = await stat(path);
		if (details.isFile()) {
			if (projectFileExtensions.has(extname(path).toLowerCase())) collected.push(path);
			return;
		}
		if (!details.isDirectory()) return;
		const entries = await readdir(path, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith('.')) continue;
			await visit(join(path, entry.name));
		}
	};
	for (const path of paths) await visit(path);
	return Array.from(new Set(collected)).sort((a, b) => a.localeCompare(b));
}

function installApplicationMenu(mainWindow: BrowserWindow) {
	const send = (command: AppCommand) => mainWindow.webContents.send('app:command', command);
	const locale = resolveLocale(app.getLocale());
	const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
	const template: MenuItemConstructorOptions[] = [
		{
			label: t('menu.file'),
			submenu: [
				{
					label: t('menu.newWorkspace'),
					accelerator: 'CmdOrCtrl+N',
					click: () => send('new-workspace')
				},
				{ type: 'separator' },
				{
					label: t('menu.openA'),
					accelerator: 'CmdOrCtrl+O',
					click: () => send('open-a')
				},
				{
					label: t('menu.openB'),
					accelerator: 'CmdOrCtrl+Shift+O',
					click: () => send('open-b')
				},
				{ type: 'separator' },
				{ role: process.platform === 'darwin' ? 'close' : 'quit' }
			]
		},
		{
			label: t('menu.navigate'),
			submenu: [
				{
					label: t('menu.commandPalette'),
					accelerator: 'CmdOrCtrl+K',
					click: () => send('command-palette')
				},
				{ type: 'separator' },
				{ label: t('tab.pcb'), accelerator: 'Alt+1', click: () => send('open-pcb') },
				{ label: t('tab.schematic'), accelerator: 'Alt+2', click: () => send('open-schematic') },
				{ label: t('tab.bom'), accelerator: 'Alt+3', click: () => send('open-bom') }
			]
		},
		{
			label: t('menu.view'),
			submenu: [
				{
					label: t('menu.toggleTools'),
					accelerator: 'CmdOrCtrl+.',
					click: () => send('toggle-tools')
				},
				{
					label: t('menu.language'),
					submenu: [
						{ label: t('menu.languageFrench'), click: () => send('set-locale-fr') },
						{ label: t('menu.languageEnglish'), click: () => send('set-locale-en') }
					]
				},
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ role: 'togglefullscreen' }
			]
		},
		{
			label: t('menu.help'),
			submenu: [
				{ label: t('menu.helpShortcuts'), accelerator: 'F1', click: () => send('show-help') },
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
			preload: join(appDirectory, '../preload/preload.mjs'),
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
		if (process.env.ADS_OPEN_DEVTOOLS === '1') {
			mainWindow.webContents.openDevTools({ mode: 'detach' });
		}
	} else {
		mainWindow.loadFile(join(appDirectory, '../renderer/index.html'));
	}
}

app.whenReady().then(() => {
	app.setName('Altium Diff Studio');
	ipcMain.handle('files:choose-project', async () => {
		const result = await dialog.showOpenDialog({
			title: 'Open Altium Diff Studio exports',
			properties: ['openFile', 'openDirectory', 'multiSelections'],
			filters: [
				{
					name: 'Altium review files',
					extensions: [
						'json',
						'pdf',
						'dxf',
						'gbr',
						'ger',
						'pho',
						'art',
						'gtl',
						'gbl',
						'gts',
						'gbs',
						'gtp',
						'gbp',
						'gto',
						'gbo',
						'gm1',
						'gm2',
						'gko',
						'gml',
						'drl',
						'xln',
						'odb',
						'odb++',
						'tgz',
						'tar',
						'gz',
						'zip'
					]
				},
				{ name: 'All files', extensions: ['*'] }
			]
		});
		if (result.canceled) return [];
		const filePaths = await collectProjectFiles(result.filePaths);
		const files = [];
		for (const path of filePaths) {
			const details = await stat(path);
			files.push({
				name: basename(path),
				path,
				size: details.size,
				data: new Uint8Array(await readFile(path))
			});
		}
		return files;
	});
	ipcMain.handle(
		'report:save-pdf',
		async (event, html: string, suggestedName: string): Promise<boolean> => {
			const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
			const options = {
				title: 'Save review report',
				defaultPath: suggestedName,
				filters: [{ name: 'PDF report', extensions: ['pdf'] }]
			};
			const result = owner
				? await dialog.showSaveDialog(owner, options)
				: await dialog.showSaveDialog(options);
			if (result.canceled || !result.filePath) return false;

			const reportWindow = new BrowserWindow({
				show: false,
				webPreferences: {
					contextIsolation: true,
					nodeIntegration: false,
					sandbox: true
				}
			});
			const temporaryPath = join(
				app.getPath('temp'),
				`altium-diff-report-${process.pid}-${Date.now()}.html`
			);
			try {
				await writeFile(temporaryPath, html, 'utf8');
				await reportWindow.loadFile(temporaryPath);
				const pdf = await reportWindow.webContents.printToPDF({
					printBackground: true,
					pageSize: 'A4',
					margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
				});
				await writeFile(result.filePath, pdf);
				return true;
			} finally {
				reportWindow.destroy();
				await unlink(temporaryPath).catch(() => undefined);
			}
		}
	);
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
