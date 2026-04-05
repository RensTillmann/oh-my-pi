/**
 * PsInspector - Detail view for a selected background job.
 *
 * Shows job metadata, result/error text, and action hints.
 */
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { formatDuration } from "@oh-my-pi/pi-utils";
import { theme } from "../../theme/theme";
import type { ProcessEntry } from "./types";

export class PsInspector implements Component {
	#entry: ProcessEntry | null = null;
	#scrollOffset = 0;
	#maxHeight = 20;
	#contentBudget = 0;
	#fullContentLength = 0;

	setEntry(entry: ProcessEntry | null): void {
		const changed = entry?.id !== this.#entry?.id;
		this.#entry = entry;
		if (changed) {
			this.#scrollOffset = 0;
			this.#fullContentLength = 0;
		}
	}

	setMaxHeight(h: number): void {
		this.#maxHeight = h;
	}

	scrollContent(delta: number): void {
		const hasOverflow = this.#fullContentLength > this.#contentBudget;
		const visibleCount = hasOverflow ? Math.max(0, this.#contentBudget - 1) : this.#contentBudget;
		const maxOff = Math.max(0, this.#fullContentLength - visibleCount);
		this.#scrollOffset = Math.max(0, Math.min(maxOff, this.#scrollOffset + delta));
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.#entry) {
			return [theme.fg("muted", "Select a job"), theme.fg("dim", "to view details")];
		}

		const entry = this.#entry;
		const lines: string[] = [];

		// Header: label
		lines.push(theme.bold(theme.fg("accent", entry.label)));

		// Status + type
		const statusLabel = this.#getStatusLabel(entry.status);
		const typeBadge = theme.fg("muted", `[${entry.type}]`);
		lines.push(`${statusLabel}  ${typeBadge}`);

		// ID
		lines.push(theme.fg("dim", `ID: ${entry.id}`));

		// Timing
		const startDate = new Date(entry.startTime);
		const timeStr = `${startDate.getHours().toString().padStart(2, "0")}:${startDate.getMinutes().toString().padStart(2, "0")}:${startDate.getSeconds().toString().padStart(2, "0")}`;
		const durationStr = formatDuration(entry.durationMs);
		lines.push(theme.fg("dim", `Started: ${timeStr}  Duration: ${durationStr}`));

		lines.push("");

		// Content: result or error
		const headerHeight = lines.length;
		this.#contentBudget = Math.max(0, this.#maxHeight - headerHeight);

		if (entry.status === "running") {
			lines.push(theme.fg("statusLineBgJobs", `Running... (${durationStr} elapsed)`));
		} else if (entry.errorText) {
			const errorLines = wrapTextWithAnsi(entry.errorText, Math.max(10, width));
			this.#fullContentLength = errorLines.length;
			const visible = this.#applyScroll(errorLines);
			lines.push(theme.fg("error", "Error:"));
			for (const line of visible) {
				lines.push(truncateToWidth(theme.fg("error", line), width));
			}
		} else if (entry.resultText) {
			const resultLines = wrapTextWithAnsi(entry.resultText, Math.max(10, width));
			this.#fullContentLength = resultLines.length;
			const visible = this.#applyScroll(resultLines);
			lines.push(theme.fg("success", "Result:"));
			for (const line of visible) {
				lines.push(truncateToWidth(line, width));
			}
		} else if (entry.status === "cancelled") {
			lines.push(theme.fg("dim", "Job was cancelled."));
		} else {
			lines.push(theme.fg("dim", "No output."));
		}

		// Scroll indicator
		if (this.#fullContentLength > this.#contentBudget && this.#contentBudget > 1) {
			const pos = this.#scrollOffset;
			const max = this.#fullContentLength - this.#contentBudget + 1;
			lines.push(theme.fg("dim", `PgUp/PgDn to scroll (${pos + 1}/${max})`));
		}

		return lines;
	}

	#applyScroll(allLines: string[]): string[] {
		const hasOverflow = this.#fullContentLength > this.#contentBudget;
		// Reserve 1 line for scroll indicator when overflowing
		const budget = hasOverflow ? Math.max(0, this.#contentBudget - 1) : this.#contentBudget;
		return allLines.slice(this.#scrollOffset, this.#scrollOffset + budget);
	}

	#getStatusLabel(status: ProcessEntry["status"]): string {
		switch (status) {
			case "running":
				return theme.fg("statusLineBgJobs", "Running");
			case "completed":
				return theme.fg("success", "Completed");
			case "failed":
				return theme.fg("error", "Failed");
			case "cancelled":
				return theme.fg("dim", "Cancelled");
		}
	}
}
