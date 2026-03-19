export const RESTRICTABLE_EXTENSION_KINDS = [
	"extension-module",
	"tool",
	"slash-command",
	"mcp",
	"hook",
	"skill",
	"prompt",
	"rule",
] as const;

type RestrictableExtensionKind = (typeof RESTRICTABLE_EXTENSION_KINDS)[number];

const restrictableKindSet = new Set<string>(RESTRICTABLE_EXTENSION_KINDS);

export function isRestrictableExtensionKind(kind: string): kind is RestrictableExtensionKind {
	return restrictableKindSet.has(kind);
}

export function filterRestrictableExtensions(restrictions: Record<string, string>): Record<string, string> {
	const filtered: Record<string, string> = {};
	for (const [id, projectPath] of Object.entries(restrictions)) {
		const colonIdx = id.indexOf(":");
		if (colonIdx === -1) continue;
		const kind = id.slice(0, colonIdx);
		if (!isRestrictableExtensionKind(kind)) continue;
		filtered[id] = projectPath;
	}
	return filtered;
}
