/**
 * Append System Prompt Capability
 *
 * APPEND_SYSTEM.md files that append content to the base system prompt.
 * Unlike SYSTEM.md (which replaces the system prompt), these files are
 * appended — allowing additive customization at both user and project level.
 */
import { defineCapability } from ".";
import type { SourceMeta } from "./types";

/**
 * An append-system-prompt file.
 */
export interface AppendSystemPrompt {
	/** Absolute path to the file */
	path: string;
	/** File content */
	content: string;
	/** Which level this came from */
	level: "user" | "project";
	/** True when the file doesn't exist on disk. Entry is shown as placeholder. */
	missing?: boolean;
	/** Source metadata */
	_source: SourceMeta;
}

export const appendSystemPromptCapability = defineCapability<AppendSystemPrompt>({
	id: "append-system-prompt",
	displayName: "System Prompt Append",
	description: "APPEND_SYSTEM.md files that append content to the base system prompt",
	// Deduplicate by level: only one user entry and one project entry at a time
	key: item => item.level,
	toExtensionId: item => `append-system-prompt:${item.level}:APPEND_SYSTEM.md`,
	validate: item => {
		if (!item.path) return "Missing path";
		if (!item.missing && item.content === undefined) return "Missing content";
		if (item.level !== "user" && item.level !== "project") return "Invalid level";
		return undefined;
	},
});
