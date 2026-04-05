/**
 * PsList - Background job list with Running/Recent grouping.
 *
 * Navigation: Up/Down/j/k to move, / to search.
 */
import { type Component, matchesKey, padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { formatDuration } from "@oh-my-pi/pi-utils";
import { theme } from "../../theme/theme";
import type { ProcessEntry, ProcessStatus } from "./types";

export interface PsListCallbacks {
	onSelectionChange?: (entry: ProcessEntry | null) => void;
}

type ListItem = { type: "section-header"; label: string; count: number } | { type: "job"; entry: ProcessEntry };

const DEFAULT_MAX_VISIBLE = 15;

export class PsList implements Component {
	#listItems: ListItem[] = [];
	#selectedIndex = 0;
	#scrollOffset = 0;
	#searchQuery = "";
	#searchActive = false;
	#focused = false;
	#maxVisible: number;

	constructor(
		private entries: ProcessEntry[],
		private readonly callbacks: PsListCallbacks = {},
		maxVisible?: number,
	) {
		this.#maxVisible = maxVisible ?? DEFAULT_MAX_VISIBLE;
		this.#rebuildList();
		this.#advanceToFirstJob();
	}

	setMaxVisible(maxVisible: number): void {
		this.#maxVisible = maxVisible;
		this.#clampSelection();
	}

	setEntries(entries: ProcessEntry[]): void {
		const prevSelected = this.getSelectedEntry();
		this.entries = entries;
		this.#rebuildList();

		// Try to preserve selection by job ID
		if (prevSelected) {
			const idx = this.#listItems.findIndex(item => item.type === "job" && item.entry.id === prevSelected.id);
			if (idx >= 0) {
				this.#selectedIndex = idx;
			}
		}
		this.#clampSelection();
	}

	setFocused(focused: boolean): void {
		this.#focused = focused;
	}

	getSelectedEntry(): ProcessEntry | null {
		const item = this.#listItems[this.#selectedIndex];
		return item?.type === "job" ? item.entry : null;
	}

	isSearchActive(): boolean {
		return this.#searchActive;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];

		// Search bar
		const searchPrefix = theme.fg("muted", "Filter: ");
		if (this.#searchActive) {
			const cursor = theme.fg("accent", "_");
			lines.push(searchPrefix + this.#searchQuery + cursor);
			lines.push(theme.fg("dim", "  Esc to cancel"));
		} else if (this.#searchQuery.length > 0) {
			lines.push(searchPrefix + this.#searchQuery);
			lines.push("");
		} else {
			lines.push(searchPrefix + theme.fg("dim", "type / to filter"));
			lines.push("");
		}

		if (this.#listItems.length === 0) {
			lines.push(theme.fg("muted", "  No background jobs."));
			return lines;
		}

		const startIdx = this.#scrollOffset;
		const endIdx = Math.min(startIdx + this.#maxVisible, this.#listItems.length);

		for (let i = startIdx; i < endIdx; i++) {
			const listItem = this.#listItems[i];
			const isSelected = this.#focused && i === this.#selectedIndex;

			if (listItem.type === "section-header") {
				lines.push(this.#renderSectionHeader(listItem, isSelected, width));
			} else {
				lines.push(this.#renderJobRow(listItem.entry, isSelected, width));
			}
		}

		// Footer
		const hintStr = theme.fg("dim", "j/k:nav  K:kill  Esc:close");
		if (this.#listItems.length > this.#maxVisible) {
			const countStr = `(${this.#selectedIndex + 1}/${this.#listItems.length})`;
			const gap = Math.max(1, width - visibleWidth(hintStr) - visibleWidth(countStr));
			lines.push(hintStr + padding(gap) + theme.fg("muted", countStr));
		} else {
			lines.push(hintStr);
		}

		return lines;
	}

	#renderSectionHeader(item: ListItem & { type: "section-header" }, isSelected: boolean, width: number): string {
		const countBadge = theme.fg("muted", `(${item.count})`);
		let line = `${item.label} ${countBadge}`;

		if (isSelected) {
			line = theme.bold(theme.fg("accent", line));
			line = theme.bg("selectedBg", line);
		} else {
			line = theme.fg("muted", line);
		}

		return truncateToWidth(line, width);
	}

	#renderJobRow(entry: ProcessEntry, isSelected: boolean, width: number): string {
		const icon = this.#getStatusIcon(entry.status);
		const duration = formatDuration(entry.durationMs);
		const durationStr = theme.fg("dim", `(${duration})`);

		// Truncate label to fit: "  <icon> <label> <duration>"
		const prefix = `   ${icon} `;
		const suffix = ` ${durationStr}`;
		const labelWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));

		let label = truncateToWidth(entry.label, labelWidth);
		if (isSelected) {
			label = theme.bold(theme.fg("accent", label));
		} else if (entry.status === "failed" || entry.status === "cancelled") {
			label = theme.fg("dim", label);
		}

		let line = prefix + label + padding(Math.max(0, labelWidth - visibleWidth(label))) + suffix;

		if (isSelected) {
			line = theme.bg("selectedBg", line);
		}

		return truncateToWidth(line, width);
	}

	#getStatusIcon(status: ProcessStatus): string {
		switch (status) {
			case "running":
				return theme.fg("statusLineBgJobs", theme.icon.bgJobs || "\u23f3");
			case "completed":
				return theme.fg("success", theme.status.enabled);
			case "failed":
				return theme.fg("error", theme.icon.warning || "!");
			case "cancelled":
				return theme.fg("dim", theme.status.disabled);
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, "up")) {
			if (this.#searchActive) this.#searchActive = false;
			this.#moveSelectionUp();
			return;
		}
		if (matchesKey(data, "down")) {
			if (this.#searchActive) this.#searchActive = false;
			this.#moveSelectionDown();
			return;
		}

		// Search mode
		if (this.#searchActive) {
			if (matchesKey(data, "backspace")) {
				if (this.#searchQuery.length > 0) {
					this.#setSearchQuery(this.#searchQuery.slice(0, -1));
				}
				return;
			}
			// Accept printable chars
			if (data.length === 1 && data.charCodeAt(0) > 32 && data.charCodeAt(0) < 127) {
				this.#setSearchQuery(this.#searchQuery + data);
				return;
			}
			// Esc exits search
			if (matchesKey(data, "escape")) {
				this.#searchActive = false;
				this.#searchQuery = "";
				this.#rebuildList();
				this.#clampSelection();
				return;
			}
			return;
		}

		// Normal mode
		if (data === "k") {
			this.#moveSelectionUp();
			return;
		}
		if (data === "j") {
			this.#moveSelectionDown();
			return;
		}
		if (data === "/") {
			this.#searchActive = true;
			this.#selectedIndex = 0;
			this.#scrollOffset = 0;
			this.#notifySelectionChange();
			return;
		}
	}

	#setSearchQuery(query: string): void {
		this.#searchQuery = query;
		this.#rebuildList();
		this.#selectedIndex = 0;
		this.#scrollOffset = 0;
		this.#notifySelectionChange();
	}

	#rebuildList(): void {
		this.#listItems = [];

		let filtered = this.entries;
		if (this.#searchQuery.length > 0) {
			const q = this.#searchQuery.toLowerCase();
			filtered = this.entries.filter(e => e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
		}

		const running = filtered.filter(e => e.status === "running");
		const recent = filtered.filter(e => e.status !== "running").sort((a, b) => b.startTime - a.startTime);

		if (running.length > 0) {
			this.#listItems.push({ type: "section-header", label: "Running", count: running.length });
			for (const entry of running) {
				this.#listItems.push({ type: "job", entry });
			}
		}

		if (recent.length > 0) {
			this.#listItems.push({ type: "section-header", label: "Recent", count: recent.length });
			for (const entry of recent) {
				this.#listItems.push({ type: "job", entry });
			}
		}
	}

	#moveSelectionUp(): void {
		if (this.#selectedIndex > 0) {
			this.#selectedIndex--;
			// Skip section headers using a loop (handles adjacent headers)
			while (this.#listItems[this.#selectedIndex]?.type === "section-header" && this.#selectedIndex > 0) {
				this.#selectedIndex--;
			}
			this.#clampSelection();
			this.#notifySelectionChange();
		}
	}

	#moveSelectionDown(): void {
		if (this.#selectedIndex < this.#listItems.length - 1) {
			this.#selectedIndex++;
			// Skip section headers using a loop (handles adjacent headers)
			while (
				this.#listItems[this.#selectedIndex]?.type === "section-header" &&
				this.#selectedIndex < this.#listItems.length - 1
			) {
				this.#selectedIndex++;
			}
			this.#clampSelection();
			this.#notifySelectionChange();
		}
	}

	/** Advance selectedIndex past any leading section headers to land on the first job item. */
	#advanceToFirstJob(): void {
		while (
			this.#listItems[this.#selectedIndex]?.type === "section-header" &&
			this.#selectedIndex < this.#listItems.length - 1
		) {
			this.#selectedIndex++;
		}
	}

	#clampSelection(): void {
		if (this.#listItems.length === 0) {
			this.#selectedIndex = 0;
			this.#scrollOffset = 0;
			return;
		}

		this.#selectedIndex = Math.min(this.#selectedIndex, this.#listItems.length - 1);
		this.#selectedIndex = Math.max(0, this.#selectedIndex);

		if (this.#selectedIndex < this.#scrollOffset) {
			this.#scrollOffset = this.#selectedIndex;
		} else if (this.#selectedIndex >= this.#scrollOffset + this.#maxVisible) {
			this.#scrollOffset = this.#selectedIndex - this.#maxVisible + 1;
		}
	}

	#notifySelectionChange(): void {
		this.callbacks.onSelectionChange?.(this.getSelectedEntry());
	}
}
