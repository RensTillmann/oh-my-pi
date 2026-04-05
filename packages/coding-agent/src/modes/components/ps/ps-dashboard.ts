/**
 * PsDashboard - Background Process Manager.
 *
 * Two-column layout: job list (left) + inspector (right).
 * Polls AsyncJobManager for live updates.
 *
 * Navigation:
 * - Up/Down/j/k: Navigate list
 * - K (shift+k): Kill selected job (with confirm)
 * - Esc: Close dashboard (clears search first if active)
 * - /: Search/filter by label
 * - PgUp/PgDn: Scroll inspector content
 */
import {
	type Component,
	Container,
	matchesKey,
	padding,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import type { AsyncJobManager } from "../../../async/job-manager";
import { theme } from "../../theme/theme";
import { DynamicBorder } from "../dynamic-border";
import { PsInspector } from "./ps-inspector";
import { PsList } from "./ps-list";
import { type ProcessEntry, toProcessEntry } from "./types";

const POLL_INTERVAL_MS = 1500;

export class PsDashboard extends Container {
	#list: PsList;
	#inspector: PsInspector;
	#pollTimer?: NodeJS.Timeout;
	#confirmKill: ProcessEntry | null = null;
	#terminalHeight: number;

	onClose?: () => void;
	onRequestRender?: () => void;

	constructor(
		private readonly jobManager: AsyncJobManager,
		terminalHeight: number,
	) {
		super();
		this.#terminalHeight = terminalHeight;

		const entries = this.#getEntries();
		const maxVisible = Math.max(5, Math.floor((terminalHeight - 10) / 2));

		this.#list = new PsList(
			entries,
			{
				onSelectionChange: entry => {
					this.#inspector.setEntry(entry);
					this.#confirmKill = null;
					this.#buildLayout();
					this.onRequestRender?.();
				},
			},
			maxVisible,
		);
		this.#list.setFocused(true);

		this.#inspector = new PsInspector();

		// Sync inspector with the list's initial selection (which may have skipped a section header)
		this.#inspector.setEntry(this.#list.getSelectedEntry());

		this.#buildLayout();
		this.#startPolling();
	}

	static create(jobManager: AsyncJobManager, terminalHeight?: number): PsDashboard {
		return new PsDashboard(jobManager, terminalHeight ?? process.stdout.rows ?? 24);
	}

	dispose(): void {
		this.#stopPolling();
	}

	handleInput(data: string): void {
		// Confirm kill mode
		if (this.#confirmKill) {
			if (data === "y" || data === "Y") {
				this.jobManager.cancel(this.#confirmKill.id);
				this.#confirmKill = null;
				this.#refreshEntries();
				this.#buildLayout();
				this.onRequestRender?.();
			} else {
				this.#confirmKill = null;
				this.#buildLayout();
				this.onRequestRender?.();
			}
			return;
		}

		// Esc: close search first, then close dashboard
		if (matchesKey(data, "escape")) {
			if (this.#list.isSearchActive()) {
				this.#list.handleInput(data);
				this.#buildLayout();
				this.onRequestRender?.();
				return;
			}
			this.#stopPolling();
			this.onClose?.();
			return;
		}

		// Kill: Shift+K
		if (data === "K") {
			const selected = this.#list.getSelectedEntry();
			if (selected && selected.status === "running") {
				this.#confirmKill = selected;
				this.#buildLayout();
				this.onRequestRender?.();
			}
			return;
		}

		// Page up/down: scroll inspector
		if (matchesKey(data, "pageUp")) {
			this.#inspector.scrollContent(-5);
			this.#buildLayout();
			this.onRequestRender?.();
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.#inspector.scrollContent(5);
			this.#buildLayout();
			this.onRequestRender?.();
			return;
		}

		// Delegate to list
		this.#list.handleInput(data);
		this.#buildLayout();
		this.onRequestRender?.();
	}

	#getEntries(): ProcessEntry[] {
		return this.jobManager.getAllJobs().map(toProcessEntry);
	}

	#refreshEntries(): void {
		const entries = this.#getEntries();
		this.#list.setEntries(entries);

		// Clear a pending kill confirm if the targeted job is no longer running
		if (this.#confirmKill) {
			const stillRunning = entries.find(e => e.id === this.#confirmKill!.id && e.status === "running");
			if (!stillRunning) this.#confirmKill = null;
		}

		// Update inspector with fresh data for the selected entry
		const selected = this.#list.getSelectedEntry();
		if (selected) {
			const fresh = entries.find(e => e.id === selected.id);
			this.#inspector.setEntry(fresh ?? null);
		}
	}

	#startPolling(): void {
		this.#pollTimer = setInterval(() => {
			try {
				this.#refreshEntries();
				this.#buildLayout();
				this.onRequestRender?.();
			} catch (_err) {
				// Prevent uncaught exception from crashing the process;
				// dashboard state is rebuilt on next tick.
			}
		}, POLL_INTERVAL_MS);
		this.#pollTimer.unref();
	}

	#stopPolling(): void {
		if (this.#pollTimer) {
			clearInterval(this.#pollTimer);
			this.#pollTimer = undefined;
		}
	}

	#buildLayout(): void {
		this.clear();

		// Top border
		this.addChild(new DynamicBorder());

		// Title
		const icon = theme.icon.bgJobs || "\u23f3";
		this.addChild(new Text(theme.bold(theme.fg("accent", ` ${icon} Background Jobs`)), 0, 0));
		this.addChild(new Spacer(1));

		const bodyMaxHeight = Math.max(5, this.#terminalHeight - 8);
		this.#inspector.setMaxHeight(bodyMaxHeight);
		this.addChild(new TwoColumnBody(this.#list, this.#inspector, bodyMaxHeight));

		// Confirm bar or help bar
		if (this.#confirmKill) {
			const name = this.#confirmKill.label;
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("warning", ` Kill "${name}"?  y: confirm  any key: cancel`), 0, 0));
		}

		// Bottom border
		this.addChild(new DynamicBorder());
	}
}

/**
 * TwoColumnBody - Side-by-side list + inspector layout.
 */
class TwoColumnBody implements Component {
	constructor(
		private readonly leftPane: PsList,
		private readonly rightPane: PsInspector,
		private readonly maxHeight: number,
	) {}

	render(width: number): string[] {
		const leftWidth = Math.floor(width * 0.45);
		const rightWidth = Math.max(0, width - leftWidth - 3);

		const leftLines = this.leftPane.render(leftWidth);
		const rightLines = this.rightPane.render(rightWidth);

		const numLines = Math.min(this.maxHeight, Math.max(leftLines.length, rightLines.length));
		const combined: string[] = [];
		const separator = theme.fg("dim", ` ${theme.boxSharp.vertical} `);

		for (let i = 0; i < numLines; i++) {
			const left = truncateToWidth(leftLines[i] ?? "", leftWidth);
			const leftPadded = left + padding(Math.max(0, leftWidth - visibleWidth(left)));
			const right = truncateToWidth(rightLines[i] ?? "", rightWidth);
			combined.push(leftPadded + separator + right);
		}

		return combined;
	}

	invalidate(): void {
		this.leftPane.invalidate?.();
		this.rightPane.invalidate?.();
	}
}
