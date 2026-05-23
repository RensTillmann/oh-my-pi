import { describe, expect, it } from "bun:test";
import { convertAnthropicMessages } from "@oh-my-pi/pi-ai/providers/anthropic";
import type { AssistantMessage, Model, UserMessage } from "@oh-my-pi/pi-ai/types";

const model: Model<"anthropic-messages"> = {
	api: "anthropic-messages",
	provider: "anthropic",
	id: "claude-opus-4-7",
	name: "Claude Opus 4.7",
	baseUrl: "https://api.anthropic.com",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	maxTokens: 8_192,
	contextWindow: 200_000,
	reasoning: true,
};

const user: UserMessage = {
	role: "user",
	content: "go",
	timestamp: Date.now(),
};

function makeAssistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

describe("Anthropic structural replay safety: assistant blocks after tool_use", () => {
	it("drops thinking and text emitted between tool_use blocks in one turn", () => {
		// Mirrors the production crash captured at
		// .omp/logs/http-400-requests/1779573241416-ep88it69f0jc.json:
		// model streamed thinking → text → tool_use → thinking → text → tool_use
		// in a single assistant turn. Anthropic rejects this on replay with
		// "messages.N: tool_use ids were found without tool_result blocks
		// immediately after" — the API treats any non-tool_use block emitted
		// after the first tool_use as a logical turn boundary.
		const assistant = makeAssistant([
			{ type: "thinking", thinking: "first reasoning", thinkingSignature: "sig_one" },
			{ type: "text", text: "I'll start by mapping the pipeline." },
			{
				type: "toolCall",
				id: "toolu_FIRST",
				name: "task",
				arguments: { _i: "first attempt" },
			},
			{ type: "thinking", thinking: "actually let me split this", thinkingSignature: "sig_two" },
			{ type: "text", text: "On reflection, splitting into parallel work is better." },
			{
				type: "toolCall",
				id: "toolu_SECOND",
				name: "todo_write",
				arguments: { ops: [] },
			},
			{
				type: "toolCall",
				id: "toolu_THIRD",
				name: "task",
				arguments: { _i: "explorer" },
			},
		]);

		const params = convertAnthropicMessages([user, assistant], model, false);
		const assistantParam = params.find(message => message.role === "assistant");
		expect(assistantParam).toBeDefined();

		const blocks = assistantParam?.content;
		expect(Array.isArray(blocks)).toBe(true);
		// Both the mid-turn thinking AND the mid-turn text are dropped; only
		// the leading thinking + text + contiguous tool_use run survives.
		expect(blocks).toEqual([
			{ type: "thinking", thinking: "first reasoning", signature: "sig_one" },
			{ type: "text", text: "I'll start by mapping the pipeline." },
			{ type: "tool_use", id: "toolu_FIRST", name: "task", input: { _i: "first attempt" } },
			{ type: "tool_use", id: "toolu_SECOND", name: "todo_write", input: { ops: [] } },
			{ type: "tool_use", id: "toolu_THIRD", name: "task", input: { _i: "explorer" } },
		]);
	});

	it("drops a standalone text block emitted between two tool_uses", () => {
		const assistant = makeAssistant([
			{
				type: "toolCall",
				id: "toolu_A",
				name: "read",
				arguments: { path: "x.ts" },
			},
			{ type: "text", text: "Now let me also read y." },
			{
				type: "toolCall",
				id: "toolu_B",
				name: "read",
				arguments: { path: "y.ts" },
			},
		]);

		const params = convertAnthropicMessages([user, assistant], model, false);
		const assistantParam = params.find(message => message.role === "assistant");
		expect(assistantParam?.content).toEqual([
			{ type: "tool_use", id: "toolu_A", name: "read", input: { path: "x.ts" } },
			{ type: "tool_use", id: "toolu_B", name: "read", input: { path: "y.ts" } },
		]);
	});

	it("drops a redacted_thinking block that appears after a tool_use", () => {
		const assistant = makeAssistant([
			{ type: "thinking", thinking: "lead-in", thinkingSignature: "sig_lead" },
			{
				type: "toolCall",
				id: "toolu_A",
				name: "read",
				arguments: { path: "x.ts" },
			},
			{ type: "redactedThinking", data: "REDACTED_DATA" },
			{
				type: "toolCall",
				id: "toolu_B",
				name: "read",
				arguments: { path: "y.ts" },
			},
		]);

		const params = convertAnthropicMessages([user, assistant], model, false);
		const assistantParam = params.find(message => message.role === "assistant");
		expect(assistantParam?.content).toEqual([
			{ type: "thinking", thinking: "lead-in", signature: "sig_lead" },
			{ type: "tool_use", id: "toolu_A", name: "read", input: { path: "x.ts" } },
			{ type: "tool_use", id: "toolu_B", name: "read", input: { path: "y.ts" } },
		]);
	});

	it("preserves a thinking block emitted before any tool_use (no false positive)", () => {
		const assistant = makeAssistant([
			{ type: "thinking", thinking: "lead reasoning", thinkingSignature: "sig_only" },
			{ type: "text", text: "Reading the file." },
			{
				type: "toolCall",
				id: "toolu_ONLY",
				name: "read",
				arguments: { path: "a.ts" },
			},
		]);

		const params = convertAnthropicMessages([user, assistant], model, false);
		const assistantParam = params.find(message => message.role === "assistant");
		expect(assistantParam?.content).toEqual([
			{ type: "thinking", thinking: "lead reasoning", signature: "sig_only" },
			{ type: "text", text: "Reading the file." },
			{ type: "tool_use", id: "toolu_ONLY", name: "read", input: { path: "a.ts" } },
		]);
	});

	it("preserves multiple consecutive thinking blocks emitted before any tool_use", () => {
		// Multiple thinking blocks at the start of a turn (before any tool_use) are
		// allowed — only thinking blocks AFTER a tool_use are structurally invalid.
		const assistant = makeAssistant([
			{ type: "thinking", thinking: "first", thinkingSignature: "sig_a" },
			{ type: "thinking", thinking: "second", thinkingSignature: "sig_b" },
			{
				type: "toolCall",
				id: "toolu_ONLY",
				name: "read",
				arguments: { path: "a.ts" },
			},
		]);

		const params = convertAnthropicMessages([user, assistant], model, false);
		const assistantParam = params.find(message => message.role === "assistant");
		expect(assistantParam?.content).toEqual([
			{ type: "thinking", thinking: "first", signature: "sig_a" },
			{ type: "thinking", thinking: "second", signature: "sig_b" },
			{ type: "tool_use", id: "toolu_ONLY", name: "read", input: { path: "a.ts" } },
		]);
	});
});
