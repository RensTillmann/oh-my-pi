/**
 * InspectorPanel - Detail view for selected extension.
 *
 * Shows name, description, origin, status, and kind-specific preview.
 */
import * as os from "node:os";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { type ThemeColor, theme } from "../../../modes/theme/theme";
import { shortenPath } from "../../../tools/render-utils";
import type { Extension } from "./types";
import { requiresRestartToTakeEffect } from "./types";

interface ToolSchema {
	parameters?: { properties?: Record<string, unknown>; required?: string[] };
	inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}
interface ToolParam {
	type?: string;
	default?: unknown;
}
interface SkillRaw {
	prompt?: string;
	instruction?: string;
	content?: string;
}
interface McpRaw {
	transport?: string;
	type?: string;
	command?: string;
	cmd?: string;
	args?: unknown[];
	arguments?: unknown[];
	url?: string;
	timeout?: number;
	auth?: { type?: string };
	env?: Record<string, unknown>;
	_toolCount?: number;
	_instructions?: string;
}

export class InspectorPanel implements Component {
	#extension: Extension | null = null;
	#previewScrollOffset = 0;
	#maxHeight = 20;
	#previewBudget = 0;
	#fullPreviewLength = 0;
	#projectPath: string | null = null;
	#showRestartHint = false;

	setExtension(extension: Extension | null): void {
		this.#extension = extension;
		this.#previewScrollOffset = 0;
		this.#showRestartHint = false;
	}

	setShowRestartHint(show: boolean): void {
		this.#showRestartHint = show;
	}

	setMaxHeight(h: number): void {
		this.#maxHeight = h;
	}

	setProjectPath(path: string): void {
		this.#projectPath = path;
	}

	scrollPreview(delta: number): void {
		const hasOverflow = this.#fullPreviewLength > this.#previewBudget;
		const visibleCount = hasOverflow ? Math.max(0, this.#previewBudget - 1) : this.#previewBudget;
		const maxOff = Math.max(0, this.#fullPreviewLength - visibleCount);
		this.#previewScrollOffset = Math.max(0, Math.min(maxOff, this.#previewScrollOffset + delta));
	}

	hasScrollOverflow(): boolean {
		return this.#fullPreviewLength > this.#previewBudget;
	}

	invalidate(): void {}

	/** Header: name, status, action hints, description, origin. */
	renderHeader(width: number): string[] {
		if (!this.#extension) {
			return [theme.fg("muted", "Select an extension"), theme.fg("dim", "to view details")];
		}

		const ext = this.#extension;
		const headerLines: string[] = [];

		// Name
		headerLines.push(theme.bold(theme.fg("accent", ext.displayName)));

		// Kind badge is omitted for append-system-prompt — the filename makes it self-evident
		const kindBadge = ext.kind !== "append-system-prompt" ? this.#getKindBadge(ext.kind) : null;
		const statusParts = this.#getStatusLines(ext);
		if (kindBadge !== null) {
			const kindStatusCombined = `${kindBadge}  ${statusParts[0]}`;
			if (Bun.stringWidth(kindStatusCombined) > width) {
				headerLines.push(truncateToWidth(kindBadge, width));
				headerLines.push(truncateToWidth(statusParts[0], width));
			} else {
				headerLines.push(kindStatusCombined);
			}
		} else {
			headerLines.push(truncateToWidth(statusParts[0], width));
		}
		for (let i = 1; i < statusParts.length; i++) {
			headerLines.push(truncateToWidth(statusParts[i], width));
		}

		// Action hints
		const restrict = ext.canRestrict ? "  R:restrict" : "";
		if (ext.source.level === "native") {
			headerLines.push(truncateToWidth(theme.fg("dim", "(native \u2014 read-only)"), width));
		} else if (ext.state === "missing") {
			headerLines.push(truncateToWidth(theme.fg("dim", "E: create"), width));
		} else if (ext.kind === "append-system-prompt") {
			headerLines.push(truncateToWidth(theme.fg("dim", `D: delete  E: edit${restrict}`), width));
		} else if (ext.kind === "context-file") {
			headerLines.push(truncateToWidth(theme.fg("dim", `D: delete  M: move  E: edit${restrict}`), width));
		} else if (width < 44) {
			headerLines.push(truncateToWidth(theme.fg("dim", "D: delete  M: move"), width));
			headerLines.push(truncateToWidth(theme.fg("dim", `N: rename  E: edit${restrict}`), width));
		} else {
			headerLines.push(truncateToWidth(theme.fg("dim", `D: delete  M: move  N: rename  E: edit${restrict}`), width));
		}
		// Dynamic restart hint: shown only after a create/edit/toggle action
		if (this.#showRestartHint && requiresRestartToTakeEffect(ext.kind) && ext.state !== "missing") {
			headerLines.push(truncateToWidth(theme.fg("dim", "Restart session for changes to take effect"), width));
		}
		headerLines.push("");

		// Description
		const desc = ext.description;
		const isValidDescription = typeof desc === "string" && desc.length > 0;
		if (isValidDescription && width > 2) {
			const wrapped = wrapTextWithAnsi(desc, width);
			for (const line of wrapped) {
				headerLines.push(truncateToWidth(line, width));
			}
			headerLines.push("");
		} else if (isValidDescription) {
			headerLines.push(truncateToWidth(desc, width));
			headerLines.push("");
		}

		// Origin
		headerLines.push(theme.fg("muted", "Origin:"));
		headerLines.push(truncateToWidth(theme.italic(`via ${ext.source.providerName}`), width));
		const shortened = shortenPath(ext.path, os.homedir());
		// Wrap path to fit panel width. wrapTextWithAnsi hard-breaks single-token
		// paths (no spaces) at the column boundary.
		const pathAvailWidth = Math.max(1, width);
		const pathLines = shortened.length > 0 ? wrapTextWithAnsi(shortened, pathAvailWidth) : [""];
		for (const pLine of pathLines) {
			headerLines.push(theme.fg("dim", pLine));
		}
		headerLines.push("");

		return headerLines;
	}

	/** Scrollable preview/instruction content. */
	renderContent(width: number, maxLines: number): string[] {
		if (!this.#extension) return [];
		const ext = this.#extension;

		const previewLines = this.#renderPreview(ext, width);
		this.#fullPreviewLength = previewLines.length;
		this.#previewBudget = maxLines;

		const hasOverflow = previewLines.length > maxLines;
		const visibleCount = hasOverflow ? Math.max(0, maxLines - 1) : maxLines;

		// Clamp scroll offset
		const maxOff = Math.max(0, previewLines.length - visibleCount);
		this.#previewScrollOffset = Math.min(this.#previewScrollOffset, maxOff);

		const visiblePreview = previewLines.slice(this.#previewScrollOffset, this.#previewScrollOffset + visibleCount);

		const lines = [...visiblePreview];

		// Scroll hint
		if (hasOverflow && maxLines > 0) {
			lines.push(theme.fg("dim", `(PgUp/PgDn to scroll — ${this.#previewScrollOffset + 1}/${previewLines.length})`));
		}

		return lines;
	}

	render(width: number): string[] {
		const header = this.renderHeader(width);
		const contentBudget = Math.max(0, this.#maxHeight - header.length);
		const content = this.renderContent(width, contentBudget);
		return [...header, ...content];
	}

	#renderPreview(ext: Extension, width: number): string[] {
		const lines: string[] = [];
		let content: string[] = [];

		switch (ext.kind) {
			case "context-file":
			case "append-system-prompt":
			case "rule":
			case "instruction":
				content = this.#renderFilePreview(ext.raw, width);
				break;
			case "tool":
				content = this.#renderToolArgs(ext.raw, width);
				break;
			case "skill":
				content = this.#renderSkillContent(ext.raw, width);
				break;
			case "mcp":
				content = this.#renderMcpDetails(ext.raw, width);
				break;
			case "slash-command":
			case "prompt":
				content = this.#renderCommandContent(ext.raw, width);
				break;
			default:
				content = this.#renderDefaultPreview(ext, width);
				break;
		}

		if (content.length > 0) {
			lines.push(...content);
		}

		return lines;
	}

	#renderFilePreview(raw: unknown, width: number): string[] {
		const lines: string[] = [];

		const content = this.#getContextFileContent(raw);
		if (!content) {
			lines.push(theme.fg("dim", "  (no content — press E to edit)"));
			lines.push("");
			return lines;
		}

		const fileLines = content.split("\n");
		for (const para of fileLines) {
			const wrapped = para.length > 0 ? wrapTextWithAnsi(para, width - 2) : [""];
			for (const line of wrapped) {
				lines.push(this.#highlightMarkdown(line));
			}
		}

		lines.push("");
		return lines;
	}

	#getContextFileContent(raw: unknown): string | null {
		if (raw && typeof raw === "object" && "content" in raw) {
			const content = (raw as { content?: unknown }).content;
			return typeof content === "string" ? content : null;
		}
		return null;
	}

	#highlightMarkdown(line: string): string {
		// Basic markdown syntax highlighting
		let highlighted = line;

		// Headers
		if (/^#{1,6}\s/.test(highlighted)) {
			highlighted = theme.bold(theme.fg("accent", highlighted));
		}
		// Code blocks
		else if (/^```/.test(highlighted)) {
			highlighted = theme.fg("dim", highlighted);
		}
		// Lists
		else if (/^[\s]*[-*+]\s/.test(highlighted)) {
			highlighted = highlighted.replace(/^([\s]*[-*+]\s)/, theme.fg("accent", "$1"));
		}
		// Numbered lists
		else if (/^[\s]*\d+\.\s/.test(highlighted)) {
			highlighted = highlighted.replace(/^([\s]*\d+\.\s)/, theme.fg("accent", "$1"));
		}

		return highlighted;
	}

	#renderToolArgs(raw: unknown, _width: number): string[] {
		const lines: string[] = [];

		try {
			const tool: ToolSchema = raw && typeof raw === "object" ? (raw as ToolSchema) : {};
			const params: Record<string, unknown> = tool.parameters?.properties ?? tool.inputSchema?.properties ?? {};

			if (Object.keys(params).length === 0) {
				lines.push(theme.fg("dim", "  (no arguments)"));
			} else {
				const required = new Set<string>(tool.parameters?.required ?? tool.inputSchema?.required ?? []);

				for (const [name, spec] of Object.entries(params)) {
					const param: ToolParam = spec && typeof spec === "object" ? (spec as ToolParam) : {};
					const type = param.type ?? "any";
					const isRequired = required.has(name);
					const defaultVal = param.default !== undefined ? `Default: ${String(param.default)}` : null;

					const nameCol = theme.fg("accent", name.padEnd(12));
					const typeCol = theme.fg("muted", type.padEnd(10));
					const reqCol = isRequired
						? theme.fg("warning", "Required")
						: defaultVal
							? theme.fg("dim", defaultVal)
							: theme.fg("dim", "Optional");

					lines.push(`  ${nameCol} ${typeCol} ${reqCol}`);
				}
			}
		} catch (err) {
			logger.debug("Failed to render tool args", { error: String(err) });
			lines.push(theme.fg("dim", "  (unable to parse tool definition)"));
		}

		lines.push("");
		return lines;
	}

	#renderSkillContent(raw: unknown, width: number): string[] {
		const lines: string[] = [];

		try {
			const skill: SkillRaw = raw && typeof raw === "object" ? (raw as SkillRaw) : {};
			const instruction = skill.prompt ?? skill.instruction ?? skill.content ?? "";

			if (!instruction) {
				lines.push(theme.fg("dim", "  (no instruction text)"));
			} else {
				const instructionLines = instruction.split("\n");
				for (const para of instructionLines) {
					const wrapped = para.length > 0 ? wrapTextWithAnsi(para, width - 2) : [""];
					for (const line of wrapped) {
						lines.push(line);
					}
				}
			}
		} catch (err) {
			logger.debug("Failed to render skill content", { error: String(err) });
			lines.push(theme.fg("dim", "  (unable to parse skill content)"));
		}

		lines.push("");
		return lines;
	}

	#renderCommandContent(raw: unknown, width: number): string[] {
		const lines: string[] = [];

		const content =
			raw && typeof raw === "object" && "content" in raw ? (raw as { content?: string }).content : undefined;

		if (!content) {
			lines.push(theme.fg("dim", "  (no content — press E to edit)"));
			lines.push("");
			return lines;
		}

		const contentLines = content.split("\n");
		for (const para of contentLines) {
			const wrapped = para.length > 0 ? wrapTextWithAnsi(para, width - 2) : [""];
			for (const line of wrapped) {
				lines.push(this.#highlightMarkdown(line));
			}
		}

		lines.push("");
		return lines;
	}

	#renderMcpDetails(raw: unknown, width: number): string[] {
		const lines: string[] = [];

		try {
			const mcp: McpRaw = raw && typeof raw === "object" ? (raw as McpRaw) : {};
			const transport = mcp.transport ?? mcp.type ?? "unknown";
			const command = mcp.command ?? mcp.cmd ?? "";
			const args = mcp.args ?? mcp.arguments ?? [];

			lines.push(`  ${theme.fg("muted", "Transport:")}  ${theme.fg("accent", transport)}`);

			if (command) {
				lines.push(`  ${theme.fg("muted", "Command:")}    ${theme.fg("success", command)}`);
			}

			if (Array.isArray(args) && args.length > 0) {
				lines.push(`  ${theme.fg("muted", "Args:")}       ${theme.fg("dim", args.join(" "))}`);
			}

			if (mcp.url) {
				lines.push(`  ${theme.fg("muted", "URL:")}        ${theme.fg("accent", mcp.url)}`);
			}

			if (mcp.timeout != null) {
				const seconds = Math.round(mcp.timeout / 1000);
				lines.push(`  ${theme.fg("muted", "Timeout:")}    ${theme.fg("dim", `${seconds}s`)}`);
			}

			if (mcp.auth?.type) {
				const authLabel = mcp.auth.type === "oauth" ? "OAuth" : "API Key";
				lines.push(`  ${theme.fg("muted", "Auth:")}       ${theme.fg("dim", authLabel)}`);
			}

			// Environment variables if present
			if (mcp.env && typeof mcp.env === "object") {
				const envCount = Object.keys(mcp.env).length;
				if (envCount > 0) {
					lines.push(`  ${theme.fg("muted", "Env vars:")}   ${theme.fg("dim", `${envCount} defined`)}`);
				}
			}

			if (typeof mcp._toolCount === "number") {
				lines.push(`  ${theme.fg("muted", "Tools:")}      ${theme.fg("dim", `${mcp._toolCount} registered`)}`);
			}

			// Server instructions (from MCP initialize response)
			if (typeof mcp._instructions === "string" && mcp._instructions.trim()) {
				lines.push("");
				for (const para of mcp._instructions.split("\n")) {
					const wrapped = para.length > 0 ? wrapTextWithAnsi(para, width - 2) : [""];
					for (const line of wrapped) {
						lines.push(this.#highlightMarkdown(line));
					}
				}
			}
		} catch (err) {
			logger.debug("Failed to render MCP details", { error: String(err) });
			lines.push(theme.fg("dim", "  (unable to parse MCP configuration)"));
		}

		lines.push("");
		return lines;
	}

	#renderDefaultPreview(ext: Extension, _width: number): string[] {
		const lines: string[] = [];

		// Show trigger pattern if present
		if (ext.trigger) {
			lines.push(`  ${theme.fg("accent", ext.trigger)}`);
			lines.push("");
		}

		return lines;
	}

	#getKindBadge(kind: string): string {
		const kindColors: Record<string, ThemeColor> = {
			"extension-module": "accent",
			skill: "accent",
			rule: "success",
			tool: "warning",
			mcp: "accent",
			prompt: "muted",
			hook: "warning",
			"context-file": "dim",
			"append-system-prompt": "dim",
			instruction: "muted",
			"slash-command": "accent",
		};

		const color: ThemeColor = kindColors[kind] ?? "muted";
		return theme.fg(color, kind);
	}

	#getStatusLines(ext: Extension): string[] {
		if (ext.state === "missing") {
			const scope = ext.source.level === "user" ? "user" : "project";
			return [theme.fg("warning", `${theme.status.disabled} File missing for ${scope}`)];
		}
		if (ext.state === "shadowed") {
			return [
				theme.fg("warning", `${theme.status.shadowed} Shadowed${ext.shadowedBy ? ` by ${ext.shadowedBy}` : ""}`),
			];
		}

		const parts: string[] = [];

		if (ext.state === "active" && !ext.isGlobalDisabled && !ext.isProjectDisabled) {
			parts.push(theme.fg("success", `${theme.status.enabled} Active`));
		}
		if (ext.isGlobalDisabled) {
			parts.push(theme.fg("error", `${theme.status.disabled} Disabled globally`));
		} else if (ext.isProjectDisabled) {
			parts.push(theme.fg("warning", `${theme.status.disabled} Disabled for this project`));
		}
		// Restriction status - always check regardless of disabled state
		if (ext.canRestrict && ext.isRestricted && ext.restrictedToProject) {
			if (ext.restrictedToProject === this.#projectPath) {
				parts.push(theme.fg("warning", `${theme.status.restricted} Restricted to this project`));
			} else {
				const shortened = shortenPath(ext.restrictedToProject, os.homedir());
				parts.push(theme.fg("warning", `${theme.status.restricted} Restricted to: ${shortened}`));
			}
		}

		if (parts.length > 0) return parts;

		if (ext.disabledReason === "provider-disabled") {
			return [theme.fg("dim", `${theme.status.disabled} Disabled (provider disabled)`)];
		}

		return [theme.fg("dim", `${theme.status.disabled} Disabled`)];
	}
}
