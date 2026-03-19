/**
 * SystemPromptEditorBody - View/edit .omp/APPEND_SYSTEM.md for the current project.
 *
 * Three sub-modes:
 *   "viewing"      – read-only preview, E to enter edit, D to delete, Tab/Esc to switch tab
 *   "editing"      – live Editor, Esc → save-prompt, Ctrl+G → external editor
 *   "save-prompt"  – inline [S]ave / [C]ancel bar replacing the help text
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Editor, matchesKey, type TUI } from "@oh-my-pi/pi-tui";
import { CONFIG_DIR_NAME } from "@oh-my-pi/pi-utils";
import { replaceTabs, truncateToWidth } from "../../../tools/render-utils";
import { getEditorCommand, openInEditor } from "../../../utils/external-editor";
import { getEditorTheme, theme } from "../../theme/theme";

type SubMode = "viewing" | "editing" | "save-prompt";

export class SystemPromptEditorBody {
	#tui: TUI;
	#filePath: string;
	/** Last persisted content (loaded or saved). */
	#content: string;
	#fileExists: boolean;
	/** True when .omp/SYSTEM.md exists — full prompt replacement is active. */
	#systemMdExists: boolean;
	#editor: Editor;
	#mode: SubMode = "viewing";
	/** True after first D press — second D confirms delete. */
	#deleteConfirm = false;
	/** Status text shown after save/delete or as a transient message. */
	#status = "";
	#scrollOffset = 0;

	onInvalidate?: () => void;

	constructor(tui: TUI, cwd: string, content: string, fileExists: boolean, systemMdExists = false) {
		this.#tui = tui;
		this.#filePath = path.join(cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
		this.#content = content;
		this.#fileExists = fileExists;
		this.#systemMdExists = systemMdExists;
		this.#editor = new Editor(getEditorTheme());
	}

	/** Current sub-mode — consulted by extension-dashboard to decide Tab/Esc routing. */
	get mode(): SubMode {
		return this.#mode;
	}

	render(width: number): string[] {
		const lines: string[] = [];

		// Path header
		const pathLabel = this.#fileExists ? `  ${this.#filePath}` : `  ${this.#filePath} (not created)`;
		lines.push(truncateToWidth(theme.fg("dim", pathLabel), width));
		lines.push("");

		// SYSTEM.md override warning — shown whenever the full prompt is replaced
		if (this.#systemMdExists) {
			lines.push(
				truncateToWidth(theme.fg("warning", "  ⚠ .omp/SYSTEM.md present — OMP base prompt is replaced"), width),
			);
			lines.push("");
		}

		if (this.#mode === "editing") {
			for (const line of this.#editor.render(width)) {
				lines.push(line);
			}
		} else if (this.#mode === "save-prompt") {
			// Show pending editor content during save prompt
			const pendingText = this.#editor.getText();
			if (pendingText) {
				for (const line of pendingText.split("\n").map(l => replaceTabs(l))) {
					lines.push(truncateToWidth(line, width));
				}
			} else {
				lines.push(theme.fg("muted", "  (empty)"));
			}
		} else {
			// View mode — scrollable read-only preview
			const contentLines = this.#content
				? this.#content.split("\n").map(l => replaceTabs(l))
				: [theme.fg("muted", `  (${this.#fileExists ? "empty \u2014 press E to edit" : "press E to create"})`)];

			for (let i = this.#scrollOffset; i < contentLines.length; i++) {
				lines.push(truncateToWidth(contentLines[i] ?? "", width));
			}
		}

		return lines;
	}

	handleInput(data: string): void {
		if (this.#mode === "save-prompt") {
			if (data === "s" || data === "S") {
				void this.#save();
			} else if (data === "e" || data === "E") {
				// Return to editing mode
				this.#mode = "editing";
				this.onInvalidate?.();
			} else {
				// C, Esc, or anything else → discard edits, back to view
				this.#mode = "viewing";
				this.#status = "";
				this.onInvalidate?.();
			}
			return;
		}

		if (this.#mode === "editing") {
			if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
				this.#mode = "save-prompt";
				this.onInvalidate?.();
				return;
			}
			if (matchesKey(data, "ctrl+g")) {
				void this.#openExternalEditor();
				return;
			}
			if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
				this.#editor.handleInput("\n");
				this.onInvalidate?.();
				return;
			}
			this.#editor.handleInput(data);
			this.onInvalidate?.();
			return;
		}

		// View mode: reset delete confirm on any key other than D
		if (data !== "d" && data !== "D") {
			if (this.#deleteConfirm) {
				this.#deleteConfirm = false;
				this.#status = "";
				this.onInvalidate?.();
			}
		}

		if (data === "e" || data === "E") {
			this.#editor.setText(this.#content);
			this.#mode = "editing";
			this.#status = "";
			this.onInvalidate?.();
			return;
		}

		if (data === "d" || data === "D") {
			if (!this.#fileExists) return;
			if (this.#deleteConfirm) {
				void this.#delete();
			} else {
				this.#deleteConfirm = true;
				this.#status = "Delete? press D again to confirm";
				this.onInvalidate?.();
			}
			return;
		}

		// Scroll view
		if (matchesKey(data, "up") || data === "k") {
			this.#scrollOffset = Math.max(0, this.#scrollOffset - 1);
			this.onInvalidate?.();
			return;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.#scrollOffset++;
			this.onInvalidate?.();
			return;
		}
	}

	/** Help-bar text reflecting current sub-mode. */
	getHelpText(): string {
		if (this.#mode === "save-prompt") {
			return theme.fg("warning", "  [S] save  [E] edit  [C] cancel");
		}
		if (this.#mode === "editing") {
			return theme.fg("dim", "  Esc: done  Ctrl+G: external editor");
		}
		if (this.#deleteConfirm) {
			return theme.fg("warning", `  ${this.#status}`);
		}
		if (this.#status) {
			return theme.fg("success", `  ${this.#status}`);
		}
		const deleteHint = this.#fileExists ? "D: delete  " : "";
		return theme.fg("dim", `  E: edit  ${deleteHint}Tab/Esc: back`);
	}

	/** Satisfy Component.invalidate — forward to embedded editor. */
	invalidate(): void {
		this.#editor.invalidate?.();
	}

	async #save(): Promise<void> {
		const text = this.#editor.getText();
		await Bun.write(this.#filePath, text);
		this.#content = text;
		this.#fileExists = true;
		this.#mode = "viewing";
		this.#status = "Saved - make sure to restart omp for your changes to take effect";
		this.onInvalidate?.();
	}

	async #delete(): Promise<void> {
		try {
			await fs.rm(this.#filePath);
		} catch {
			// already gone
		}
		this.#content = "";
		this.#fileExists = false;
		this.#deleteConfirm = false;
		this.#mode = "viewing";
		this.#status = "Deleted - make sure to restart omp for your changes to take effect";
		this.onInvalidate?.();
	}

	async #openExternalEditor(): Promise<void> {
		const cmd = getEditorCommand();
		if (!cmd) return;
		let editSucceeded = false;
		try {
			this.#tui.stop();
			const result = await openInEditor(cmd, this.#editor.getText());
			if (result !== null) {
				this.#editor.setText(result);
				editSucceeded = true;
			}
		} finally {
			this.#tui.start();
		}
		// Transition to save-prompt mode and trigger proper re-render
		this.#mode = "save-prompt";
		if (!editSucceeded) {
			this.#status = "External editor failed - changes not applied";
		}
		this.onInvalidate?.();
	}
}
