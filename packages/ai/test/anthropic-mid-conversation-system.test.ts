import { describe, expect, it } from "bun:test";
import { convertAnthropicMessages } from "@oh-my-pi/pi-ai/providers/anthropic";
import type { AssistantMessage, DeveloperMessage, Message, Model, UserMessage } from "@oh-my-pi/pi-ai/types";

/**
 * Opus 4.8+ on the first-party Anthropic API accepts `system`-role messages
 * mid-conversation. convertAnthropicMessages upgrades a qualifying developer
 * turn (follows a user turn, and is either last or immediately precedes an
 * assistant turn) into a mid-conversation system message.
 */
function makeModel(id: string, baseUrl = "https://api.anthropic.com"): Model<"anthropic-messages"> {
	return {
		api: "anthropic-messages",
		provider: "anthropic",
		id,
		name: id,
		baseUrl,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		maxTokens: 8192,
		contextWindow: 200000,
		reasoning: true,
	};
}

function user(content: string): UserMessage {
	return { role: "user", content, timestamp: Date.now() };
}

function developer(content: string): DeveloperMessage {
	return { role: "developer", content, timestamp: Date.now() };
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-4-8",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const roles = (params: ReturnType<typeof convertAnthropicMessages>) => params.map(p => p.role);

describe("Anthropic mid-conversation system role (Opus 4.8+)", () => {
	it("upgrades a developer turn between user and assistant", () => {
		const messages: Message[] = [user("hi"), developer("steer"), assistant("ok")];
		const params = convertAnthropicMessages(messages, makeModel("claude-opus-4-8"), false);
		// trailing turn is assistant, so a synthetic "Continue." user turn is appended
		expect(roles(params)).toEqual(["user", "system", "assistant", "user"]);
		expect(params[1]?.content).toBe("steer");
	});

	it("upgrades a trailing developer turn that follows a user", () => {
		const messages: Message[] = [user("hi"), developer("steer")];
		const params = convertAnthropicMessages(messages, makeModel("claude-opus-4-8"), false);
		expect(roles(params)).toEqual(["user", "system"]);
		expect(params[1]?.content).toBe("steer");
	});

	it("does not upgrade a leading developer turn", () => {
		const messages: Message[] = [developer("steer"), assistant("ok")];
		const params = convertAnthropicMessages(messages, makeModel("claude-opus-4-8"), false);
		expect(params[0]?.role).toBe("user");
		expect(roles(params)).toEqual(["user", "assistant", "user"]);
	});

	it("does not upgrade a developer turn followed by a user turn", () => {
		const messages: Message[] = [user("hi"), developer("steer"), user("again")];
		const params = convertAnthropicMessages(messages, makeModel("claude-opus-4-8"), false);
		expect(roles(params)).toEqual(["user", "user", "user"]);
	});

	it("does not upgrade for models below Opus 4.8", () => {
		const messages: Message[] = [user("hi"), developer("steer"), assistant("ok")];
		const params = convertAnthropicMessages(messages, makeModel("claude-opus-4-7"), false);
		expect(roles(params)).toEqual(["user", "user", "assistant", "user"]);
	});

	it("does not upgrade when the base URL is not the first-party API", () => {
		const messages: Message[] = [user("hi"), developer("steer"), assistant("ok")];
		const params = convertAnthropicMessages(
			messages,
			makeModel("claude-opus-4-8", "https://proxy.example.com"),
			false,
		);
		expect(roles(params)).toEqual(["user", "user", "assistant", "user"]);
	});
});
