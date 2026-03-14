import * as fs from "node:fs/promises";
import { invalidate } from "../../../capability";
import type { Extension, ExtensionKind } from "./types";

export interface ActionResult { ok: boolean; error?: string; }
export interface MoveTarget { label: string; provider: string; scope: "user" | "project"; targetDir: string; }

const KIND_DIRS: Partial<Record<ExtensionKind, string>> = {
	skill: "skills",
	rule: "rules",
	prompt: "prompts",
	"slash-command": "commands",
	instruction: "instructions",
	hook: "hooks",
	tool: "tools",
	"extension-module": "extensions",
};

export { KIND_DIRS };

export async function deleteExtension(ext: Extension): Promise<ActionResult> {
	try {
		if (ext.source.level === "native") {
			return { ok: false, error: "Cannot delete native extensions" };
		}

		try {
			await fs.access(ext.path);
		} catch {
			return { ok: false, error: "File not found" };
		}

		if (ext.kind === "mcp") {
			const raw = await fs.readFile(ext.path, "utf-8");
			const json = JSON.parse(raw) as Record<string, unknown>;

			const serversKey = "mcpServers" in json ? "mcpServers" : "servers" in json ? "servers" : null;
			if (serversKey !== null) {
				const servers = json[serversKey] as Record<string, unknown>;
				delete servers[ext.name];

				const serversEmpty = Object.keys(servers).length === 0;
				const otherKeys = Object.keys(json).filter(k => k !== serversKey);
				if (serversEmpty && otherKeys.length === 0) {
					await fs.unlink(ext.path);
				} else {
					if (serversEmpty) {
						delete json[serversKey];
					}
					await fs.writeFile(ext.path, JSON.stringify(json, null, 2), "utf-8");
				}
			}
		} else if (ext.kind === "tool" || ext.kind === "extension-module") {
			const stat = await fs.stat(ext.path);
			if (stat.isDirectory()) {
				await fs.rm(ext.path, { recursive: true, force: true });
			} else {
				await fs.unlink(ext.path);
			}
		} else {
			// skill, rule, prompt, slash-command, instruction, hook, context-file
			await fs.unlink(ext.path);
		}

		invalidate(ext.path);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}
