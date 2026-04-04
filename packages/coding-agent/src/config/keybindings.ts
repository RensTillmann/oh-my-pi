import * as fs from "node:fs";
import * as path from "node:path";
import {
	EditorKeybindingsManager,
	type Keybinding,
	type KeybindingDefinitions,
	type KeyId,
	setEditorKeybindings,
	TUI_KEYBINDINGS,
	type KeybindingsConfig as TuiKeybindingsConfig,
	KeybindingsManager as TuiKeybindingsManager,
} from "@oh-my-pi/pi-tui";
import { getAgentDir, isEnoent, logger } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Declaration merging: extend the tui Keybindings interface with app-level keys
// ---------------------------------------------------------------------------

declare module "@oh-my-pi/pi-tui" {
	interface Keybindings {
		"app.interrupt": true;
		"app.clear": true;
		"app.exit": true;
		"app.suspend": true;
		"app.render.pause": true;
		"app.render.resume": true;
		"app.thinking.cycleLevel": true;
		"app.model.cycleForward": true;
		"app.model.cycleBackward": true;
		"app.model.select": true;
		"app.model.selectTemporary": true;
		"app.plan.toggle": true;
		"app.tools.expand": true;
		"app.thinking.toggle": true;
		"app.editor.external": true;
		"app.history.search": true;
		"app.message.followUp": true;
		"app.message.dequeue": true;
		"app.clipboard.pasteImage": true;
		"app.clipboard.copyLine": true;
		"app.clipboard.copyPrompt": true;
		"app.session.new": true;
		"app.session.tree": true;
		"app.session.fork": true;
		"app.session.resume": true;
		"app.stt.toggle": true;
		"app.bash.background": true;
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Application-level keybinding names (coding-agent specific).
 */
export type AppAction =
	| "app.interrupt"
	| "app.clear"
	| "app.exit"
	| "app.suspend"
	| "app.render.pause"
	| "app.render.resume"
	| "app.thinking.cycleLevel"
	| "app.model.cycleForward"
	| "app.model.cycleBackward"
	| "app.model.select"
	| "app.model.selectTemporary"
	| "app.plan.toggle"
	| "app.tools.expand"
	| "app.thinking.toggle"
	| "app.editor.external"
	| "app.history.search"
	| "app.message.followUp"
	| "app.message.dequeue"
	| "app.clipboard.pasteImage"
	| "app.clipboard.copyLine"
	| "app.clipboard.copyPrompt"
	| "app.session.new"
	| "app.session.tree"
	| "app.session.fork"
	| "app.session.resume"
	| "app.stt.toggle"
	| "app.bash.background";

/** Alias used by extension types and keybinding-hints. */
export type AppKeybinding = AppAction;

/**
 * All configurable actions (app + editor).
 */
export type KeyAction = AppAction | Keybinding;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/** Keybinding definitions for all app-level actions. */
export const APP_KEYBINDING_DEFINITIONS = {
	"app.interrupt": { defaultKeys: "escape", description: "Interrupt / cancel" },
	"app.clear": { defaultKeys: "ctrl+c", description: "Clear editor / exit" },
	"app.exit": { defaultKeys: "ctrl+d", description: "Exit" },
	"app.suspend": { defaultKeys: "ctrl+z", description: "Suspend to background" },
	"app.render.pause": { defaultKeys: "ctrl+s", description: "Pause UI rendering" },
	"app.render.resume": { defaultKeys: "ctrl+q", description: "Resume UI rendering" },
	"app.thinking.cycleLevel": { defaultKeys: "shift+tab", description: "Cycle thinking level" },
	"app.model.cycleForward": { defaultKeys: "ctrl+p", description: "Cycle model forward" },
	"app.model.cycleBackward": { defaultKeys: "shift+ctrl+p", description: "Cycle model backward" },
	"app.model.select": { defaultKeys: "ctrl+l", description: "Select model (set roles)" },
	"app.model.selectTemporary": { defaultKeys: "alt+p", description: "Select model (temporary)" },
	"app.plan.toggle": { defaultKeys: "alt+shift+p", description: "Toggle plan mode" },
	"app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output expansion" },
	"app.thinking.toggle": { defaultKeys: "ctrl+t", description: "Toggle thinking block" },
	"app.editor.external": { defaultKeys: "ctrl+g", description: "Edit in external editor" },
	"app.history.search": { defaultKeys: "ctrl+r", description: "Search prompt history" },
	"app.message.followUp": { defaultKeys: "ctrl+enter", description: "Follow-up message" },
	"app.message.dequeue": { defaultKeys: "alt+up", description: "Restore queued message" },
	"app.clipboard.pasteImage": { defaultKeys: "ctrl+v", description: "Paste image from clipboard" },
	"app.clipboard.copyLine": { defaultKeys: "alt+shift+l", description: "Copy current line" },
	"app.clipboard.copyPrompt": { defaultKeys: "alt+shift+c", description: "Copy whole prompt" },
	"app.session.new": { defaultKeys: [] as KeyId[], description: "New session" },
	"app.session.tree": { defaultKeys: [] as KeyId[], description: "Session tree" },
	"app.session.fork": { defaultKeys: [] as KeyId[], description: "Fork session" },
	"app.session.resume": { defaultKeys: [] as KeyId[], description: "Resume session" },
	"app.stt.toggle": { defaultKeys: "alt+h", description: "Toggle speech-to-text" },
	"app.bash.background": { defaultKeys: "ctrl+b", description: "Background bash" },
} as const satisfies KeybindingDefinitions;

/** Combined definitions (tui + app). */
const ALL_DEFINITIONS: KeybindingDefinitions = {
	...TUI_KEYBINDINGS,
	...APP_KEYBINDING_DEFINITIONS,
};

// ---------------------------------------------------------------------------
// Legacy name migration
// ---------------------------------------------------------------------------

/** Map from legacy short names (and camelCase editor names) to qualified names. */
const LEGACY_NAME_MAP: Record<string, string> = {
	// App actions
	interrupt: "app.interrupt",
	clear: "app.clear",
	exit: "app.exit",
	suspend: "app.suspend",
	pauseRender: "app.render.pause",
	resumeRender: "app.render.resume",
	cycleThinkingLevel: "app.thinking.cycleLevel",
	cycleModelForward: "app.model.cycleForward",
	cycleModelBackward: "app.model.cycleBackward",
	selectModel: "app.model.select",
	selectModelTemporary: "app.model.selectTemporary",
	togglePlanMode: "app.plan.toggle",
	expandTools: "app.tools.expand",
	toggleThinking: "app.thinking.toggle",
	externalEditor: "app.editor.external",
	historySearch: "app.history.search",
	followUp: "app.message.followUp",
	dequeue: "app.message.dequeue",
	pasteImage: "app.clipboard.pasteImage",
	copyLine: "app.clipboard.copyLine",
	copyPrompt: "app.clipboard.copyPrompt",
	newSession: "app.session.new",
	tree: "app.session.tree",
	fork: "app.session.fork",
	resume: "app.session.resume",
	toggleSTT: "app.stt.toggle",
	backgroundBash: "app.bash.background",
	// Editor/tui actions
	cursorUp: "tui.editor.cursorUp",
	cursorDown: "tui.editor.cursorDown",
	cursorLeft: "tui.editor.cursorLeft",
	cursorRight: "tui.editor.cursorRight",
	cursorWordLeft: "tui.editor.cursorWordLeft",
	cursorWordRight: "tui.editor.cursorWordRight",
	cursorLineStart: "tui.editor.cursorLineStart",
	cursorLineEnd: "tui.editor.cursorLineEnd",
	jumpForward: "tui.editor.jumpForward",
	jumpBackward: "tui.editor.jumpBackward",
	pageUp: "tui.editor.pageUp",
	pageDown: "tui.editor.pageDown",
	deleteCharBackward: "tui.editor.deleteCharBackward",
	deleteCharForward: "tui.editor.deleteCharForward",
	deleteWordBackward: "tui.editor.deleteWordBackward",
	deleteWordForward: "tui.editor.deleteWordForward",
	deleteToLineStart: "tui.editor.deleteToLineStart",
	deleteToLineEnd: "tui.editor.deleteToLineEnd",
	yank: "tui.editor.yank",
	yankPop: "tui.editor.yankPop",
	undo: "tui.editor.undo",
	newLine: "tui.input.newLine",
	submit: "tui.input.submit",
	tab: "tui.input.tab",
	copy: "tui.input.copy",
	selectUp: "tui.select.up",
	selectDown: "tui.select.down",
	selectPageUp: "tui.select.pageUp",
	selectPageDown: "tui.select.pageDown",
	selectConfirm: "tui.select.confirm",
	selectCancel: "tui.select.cancel",
};

function migrateConfig(config: Record<string, unknown>): { migrated: TuiKeybindingsConfig; dirty: boolean } {
	const result: TuiKeybindingsConfig = {};
	let dirty = false;
	for (const [key, value] of Object.entries(config)) {
		const newKey = LEGACY_NAME_MAP[key];
		if (newKey) {
			result[newKey] = value as KeyId | KeyId[];
			dirty = true;
		} else {
			result[key] = value as KeyId | KeyId[];
		}
	}
	return { migrated: result, dirty };
}

// ---------------------------------------------------------------------------
// Key hint formatting
// ---------------------------------------------------------------------------

const MODIFIER_LABELS: Record<string, string> = {
	ctrl: "Ctrl",
	shift: "Shift",
	alt: "Alt",
};

const KEY_LABELS: Record<string, string> = {
	esc: "Esc",
	escape: "Esc",
	enter: "Enter",
	return: "Enter",
	space: "Space",
	tab: "Tab",
	backspace: "Backspace",
	delete: "Delete",
	home: "Home",
	end: "End",
	pageup: "PgUp",
	pagedown: "PgDn",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
};

function formatKeyPart(part: string): string {
	const lower = part.toLowerCase();
	const modifier = MODIFIER_LABELS[lower];
	if (modifier) return modifier;
	const label = KEY_LABELS[lower];
	if (label) return label;
	if (part.length === 1) return part.toUpperCase();
	return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}

export function formatKeyHint(key: KeyId): string {
	return key.split("+").map(formatKeyPart).join("+");
}

export function formatKeyHints(keys: KeyId | KeyId[]): string {
	const list = Array.isArray(keys) ? keys : [keys];
	return list.map(formatKeyHint).join("/");
}

// ---------------------------------------------------------------------------
// KeybindingsManager
// ---------------------------------------------------------------------------

/**
 * Manages all keybindings (app + editor).
 *
 * Extends tui's KeybindingsManager with app-specific definitions and
 * migration of legacy short names.
 */
export class KeybindingsManager extends TuiKeybindingsManager {
	/**
	 * Create from config file, migrate legacy names, set up editor keybindings.
	 */
	static create(agentDir: string = getAgentDir()): KeybindingsManager {
		const configPath = path.join(agentDir, "keybindings.json");
		const { config, dirty } = KeybindingsManager.#loadAndMigrate(configPath);

		if (dirty) {
			try {
				fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			} catch (err) {
				logger.warn("Failed to write migrated keybindings config", { path: configPath, error: String(err) });
			}
		}

		const manager = new KeybindingsManager(ALL_DEFINITIONS, config);

		// Set up editor keybindings globally
		const editorConfig: Record<string, KeyId | KeyId[]> = {};
		for (const [action, keys] of Object.entries(config)) {
			if (action.startsWith("tui.")) {
				editorConfig[action] = keys as KeyId | KeyId[];
			}
		}
		setEditorKeybindings(new EditorKeybindingsManager(editorConfig));

		return manager;
	}

	/**
	 * Create in-memory (for tests and initial state).
	 */
	static inMemory(config: TuiKeybindingsConfig = {}): KeybindingsManager {
		return new KeybindingsManager(ALL_DEFINITIONS, config);
	}

	static #loadAndMigrate(filePath: string): { config: TuiKeybindingsConfig; dirty: boolean } {
		try {
			const text = readFileSync(filePath);
			if (!text) return { config: {}, dirty: false };
			const raw = JSON.parse(text) as Record<string, unknown>;
			const { migrated: config, dirty } = migrateConfig(raw);
			return { config, dirty };
		} catch (error) {
			if (isEnoent(error)) return { config: {}, dirty: false };
			logger.warn("Failed to parse keybindings config", { path: filePath, error: String(error) });
			return { config: {}, dirty: false };
		}
	}

	/**
	 * Get display string for an action.
	 */
	getDisplayString(action: Keybinding): string {
		return formatKeyHints(this.getKeys(action));
	}
}

/**
 * Synchronous file read helper (keybindings must load before TUI starts).
 */
function readFileSync(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch (err) {
		if (isEnoent(err)) return null;
		throw err;
	}
}

// Re-export for convenience
export type { KeyId };
