import * as os from "node:os";
import { Container, Editor, matchesKey, Spacer, Text } from "@oh-my-pi/pi-tui";
import { shortenPath } from "../../../tools/render-utils";
import { getEditorTheme, theme } from "../../theme/theme";
import { DynamicBorder } from "../dynamic-border";

type InlineEditorMode = "editing" | "save-prompt";

export class InlineFileEditorComponent extends Container {
	#editor: Editor;
	#hintText: Text;
	#statusText: Text;
	#mode: InlineEditorMode = "editing";
	#saving = false;

	constructor(
		filePath: string,
		initialContent: string,
		private readonly onSave: (content: string) => Promise<void>,
		private readonly onCancel: () => void,
	) {
		super();

		const displayPath = shortenPath(filePath, os.homedir());

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", "Inline file editor"), 1, 0));
		this.addChild(new Text(theme.fg("dim", ` ${displayPath}`), 1, 0));

		this.#statusText = new Text("", 1, 0);
		this.addChild(this.#statusText);
		this.addChild(new Spacer(1));

		this.#editor = new Editor(getEditorTheme());
		this.#editor.setText(initialContent);
		this.addChild(this.#editor);
		this.addChild(new Spacer(1));

		this.#hintText = new Text("", 1, 0);
		this.addChild(this.#hintText);
		this.addChild(new DynamicBorder());

		this.#refreshHints();
	}

	getEditor(): Editor {
		return this.#editor;
	}

	handleInput(data: string): void {
		if (this.#saving) return;

		if (this.#mode === "save-prompt") {
			if (data === "s" || data === "S") {
				void this.#save();
				return;
			}
			if (data === "c" || data === "C") {
				this.onCancel();
				return;
			}
			if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
				this.#mode = "editing";
				this.#refreshHints();
				return;
			}
			return;
		}

		if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
			this.#mode = "save-prompt";
			this.#refreshHints();
			return;
		}

		if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
			this.#editor.handleInput("\n");
			return;
		}

		this.#editor.handleInput(data);
	}

	#refreshHints(): void {
		if (this.#mode === "save-prompt") {
			this.#hintText.setText(theme.fg("warning", " [S] save  [C] cancel  Esc: continue editing"));
			return;
		}
		this.#hintText.setText(theme.fg("dim", " Esc: done (show save/cancel)"));
	}

	async #save(): Promise<void> {
		this.#saving = true;
		this.#statusText.setText(theme.fg("dim", " Saving..."));
		try {
			await this.onSave(this.#editor.getText());
		} catch (error) {
			this.#saving = false;
			this.#mode = "editing";
			this.#statusText.setText(theme.fg("error", ` Save failed: ${String(error)}`));
			this.#refreshHints();
		}
	}
}
