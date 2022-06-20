import { App, FileSystemAdapter, Plugin, PluginSettingTab, Setting, addIcon } from 'obsidian';

const svg = `
<path
  fill="currentColor"
  d="M 96.453125 10.773438 L 75.882812 0.878906 C 73.488281 -0.277344 70.640625 0.210938 68.769531 2.082031 L 29.367188 38.035156 L 12.195312 25.011719 C 10.601562 23.789062 8.351562 23.890625 6.871094 25.242188 L 1.371094 30.253906 C -0.449219 31.898438 -0.449219 34.761719 1.355469 36.40625 L 16.25 49.996094 L 1.355469 63.585938 C -0.449219 65.230469 -0.449219 68.097656 1.371094 69.742188 L 6.871094 74.753906 C 8.367188 76.101562 10.601562 76.203125 12.195312 74.980469 L 29.367188 61.945312 L 68.789062 97.914062 C 70.644531 99.785156 73.492188 100.273438 75.882812 99.117188 L 96.476562 89.203125 C 98.640625 88.164062 100.007812 85.980469 100.007812 83.570312 L 100.007812 16.398438 C 100.007812 14.007812 98.621094 11.808594 96.460938 10.769531 Z M 75.015625 72.707031 L 45.101562 50 L 75.015625 27.292969 Z M 75.015625 72.707031"
/>`;

addIcon('vscode-logo', svg);

type AppWithPlugins = App & {
	plugins: {
		disablePlugin: (id: string) => {};
		enablePlugin: (id: string) => {};
		enabledPlugins: Set<string>;
		plugins: Record<string, any>;
	};
};

let DEV: boolean = false;

export default class OpenVSCode extends Plugin {
	ribbonIcon: HTMLElement;
	settings: OpenVSCodeSettings;

	async onload() {
		console.log('Loading ' + this.manifest.name + ' plugin');
		this.addSettingTab(new OpenVSCodeSettingsTab(this.app, this));
		await this.loadSettings();

		this.refreshIconRibbon();

		this.addCommand({
			id: 'open-vscode',
			name: 'Open as Visual Studio Code workspace',
			callback: this.openVSCode.bind(this),
		});

		this.addCommand({
			id: 'open-vscode-via-url',
			name: 'Open as Visual Studio Code workspace using a vscode:// URL',
			callback: this.openVSCodeUrl.bind(this),
		});

		DEV =
			(this.app as AppWithPlugins).plugins.enabledPlugins.has('hot-reload') &&
			(this.app as AppWithPlugins).plugins.plugins['hot-reload'].enabledPlugins.has(this.manifest.id);

		if (DEV) {
			this.addCommand({
				id: 'open-vscode-reload',
				name: 'Reload the plugin in dev',
				callback: this.reload.bind(this),
			});

			this.addCommand({
				id: 'open-vscode-reset-settings',
				name: 'Reset plugins settings to default in dev',
				callback: this.resetSettings.bind(this),
			});
		}
	}

	/**
	 * [pjeby](https://forum.obsidian.md/t/how-to-get-started-with-developing-a-custom-plugin/8157/7)
	 *
	 * > Of course, while doing development, you may need to reload your plugin
	 * > after making changes. You can do this by reloading, sure, but it’s easier
	 * > to just go to settings and then toggle the plugin off, then back on again.
	 * >
	 * > You can also automate this process from within the plugin itself, by
	 * > including a command that does something like this:
	 */
	async reload() {
		const id = this.manifest.id;
		const plugins = (this.app as AppWithPlugins).plugins;
		await plugins.disablePlugin(id);
		await plugins.enablePlugin(id);
		console.log('[open-vscode] reloaded', this);
	}

	async openVSCode() {
		if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
			return;
		}
		const { executeTemplate } = this.settings;

		const path = this.app.vault.adapter.getBasePath();
		const file = this.app.workspace.getActiveFile();
		const filePath = file?.path ?? '';

		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { exec } = require('child_process');

		let command = executeTemplate.trim() === '' ? DEFAULT_SETTINGS.executeTemplate : executeTemplate;
		command = replaceAll(command, '{{vaultpath}}', path);
		command = replaceAll(command, '{{filepath}}', filePath);
		if (DEV) console.log('[openVSCode]', { command });
		exec(command, (error: never, stdout: never, stderr: never) => {
			if (error) {
				console.error(`[openVSCode] exec error: ${error}`);
			}
		});
	}

	async openVSCodeUrl() {
		if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
			return;
		}
		const { openFile } = this.settings;

		const path = this.app.vault.adapter.getBasePath();
		const file = this.app.workspace.getActiveFile();
		const filePath = file?.path ?? '';
		if (DEV)
			console.log('[open-vscode]', {
				settings: this.settings,
				path,
				filePath,
			});

		// https://code.visualstudio.com/docs/editor/command-line#_opening-vs-code-with-urls
		let url = `vscode://file/${path}`;

		if (openFile) {
			url += `/${filePath}`;
			/*
			By default, opening a file via the vscode:// URL will cause that file to open
			in the front-most window in VSCode. We assume that it is preferred that files from
			Obsidian should all open in the same workspace.

			As a workaround, we issue two open requests to VSCode in quick succession: the first to
			bring the workspace to front, the second to open the file.

			There is a ticket requesting this feature for VSCode:
			https://github.com/microsoft/vscode/issues/150078
			*/

			// HACK: first open the _workspace_ to bring the correct window to the front....
			const workspacePath = replaceAll(this.settings.workspacePath, '{{vaultpath}}', path);
			window.open(`vscode://file/${workspacePath}`);

			// ...then open the _file_ in a setTimeout callback to allow time for the workspace to be activated
			setTimeout(() => {
				if (DEV) console.log('[openVSCode]', { url });
				window.open(url);
			}, 200); // anecdotally, this seems to be the min required for the workspace to activate
		} else {
			if (DEV) console.log('[openVSCode]', { url });
			window.open(url);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async resetSettings() {
		console.log('[open-vscode]', { old: this.settings, DEFAULT_SETTINGS });
		this.settings = DEFAULT_SETTINGS;
		await this.saveData(this.settings);
	}

	refreshIconRibbon = () => {
		this.ribbonIcon?.remove();
		if (this.settings.ribbonIcon) {
			this.ribbonIcon = this.addRibbonIcon('vscode-logo', 'VSCode', () => {
				this.openVSCode();
			});
		}
	};
}

interface OpenVSCodeSettings {
	ribbonIcon: boolean;
	executeTemplate: string;
	openFile: boolean;
	workspacePath: string;
}

const DEFAULT_SETTINGS: OpenVSCodeSettings = {
	ribbonIcon: true,
	executeTemplate: 'code "{{vaultpath}}" "{{vaultpath}}/{{filepath}}"',
	openFile: true,
	workspacePath: '{{vaultpath}}',
};

class OpenVSCodeSettingsTab extends PluginSettingTab {
	plugin: OpenVSCode;

	constructor(app: App, plugin: OpenVSCode) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h3', { text: 'General settings' });

		new Setting(containerEl)
			.setName('Display Ribbon Icon')
			.setDesc('Turn on if you want to have a Ribbon Icon.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.ribbonIcon).onChange((value) => {
					this.plugin.settings.ribbonIcon = value;
					this.plugin.saveSettings();
					this.plugin.refreshIconRibbon();
				}),
			);

		containerEl.createEl('h3', { text: 'Open via `code` CLI settings' });

		new Setting(containerEl)
			.setName('Template for executing the `code` command')
			.setDesc(
				'You can use the following variables: `{{vaultpath}}` (absolute), `{{filepath}}` (relative). Note that on MacOS, a full path to the VSCode executable is required (generally "/usr/local/bin/code"). Example: `/usr/local/bin/code "{{vaultpath}}" "{{vaultpath}}/{{filepath}}"`',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.executeTemplate)
					.setValue(this.plugin.settings.executeTemplate || DEFAULT_SETTINGS.executeTemplate)
					.onChange((value) => {
						value = value.trim();
						if (value === '') value = DEFAULT_SETTINGS.executeTemplate;
						this.plugin.settings.executeTemplate = value;
						this.plugin.saveData(this.plugin.settings);
					}),
			);

		containerEl.createEl('h3', { text: 'Open via `vscode://` URL settings' });

		new Setting(containerEl)
			.setName('Open current file')
			.setDesc('Open the current file rather than the root of the vault.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openFile || DEFAULT_SETTINGS.openFile).onChange((value) => {
					this.plugin.settings.openFile = value;
					this.plugin.saveData(this.plugin.settings);
				}),
			);

		new Setting(containerEl)
			.setName('Path to VSCode Workspace')
			.setDesc(
				'Defaults to the {{vaultpath}} template variable. You can set this to an absolute path to a ".code-workspace" file if you prefer to use a Multi Root workspace file: ',
			)
			.setClass('setting-item--vscode-workspacePath')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.workspacePath)
					.setValue(this.plugin.settings.workspacePath || DEFAULT_SETTINGS.workspacePath)
					.onChange((value) => {
						value = value.trim();
						if (value === '') value = DEFAULT_SETTINGS.workspacePath;
						this.plugin.settings.workspacePath = value;
						this.plugin.saveData(this.plugin.settings);
					}),
			);

		const workspacePathDescEl = containerEl.querySelector(
			'.setting-item--vscode-workspacePath .setting-item-description',
		);
		workspacePathDescEl.appendChild(
			createEl('a', {
				href: 'https://code.visualstudio.com/docs/editor/workspaces#_multiroot-workspaces',
				text: 'https://code.visualstudio.com/docs/editor/workspaces#_multiroot-workspaces',
			}),
		);
		workspacePathDescEl.appendText('.');
	}
}

// https://stackoverflow.com/questions/1144783/how-to-replace-all-occurrences-of-a-string-in-javascript
function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceAll(str: string, find: string, replace: string) {
	return str.replace(new RegExp(escapeRegExp(find), 'g'), replace);
}
