import { describe, expect, it } from "bun:test";
import { Effort } from "@oh-my-pi/pi-ai/model-thinking";
import { streamAnthropic } from "@oh-my-pi/pi-ai/providers/anthropic";
import type { Context, Model } from "@oh-my-pi/pi-ai/types";

/**
 * Integration: the built request payload (captured via onPayload before the
 * already-aborted request fires) must carry the 5-tier "xhigh" effort and the
 * summarized thinking display for Opus 4.7+, and the legacy 4-tier map for
 * older Opus models.
 */
function makeAdaptiveModel(id: string): Model<"anthropic-messages"> {
	return {
		id,
		name: id,
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
		thinking: { mode: "anthropic-adaptive", minLevel: Effort.Minimal, maxLevel: Effort.XHigh },
	};
}

function abortedSignal(): AbortSignal {
	const controller = new AbortController();
	controller.abort();
	return controller.signal;
}

type CapturedPayload = {
	output_config?: { effort?: string };
	thinking?: { type?: string; display?: string };
};

function capturePayload(model: Model<"anthropic-messages">, reasoning: Effort): Promise<CapturedPayload> {
	const context: Context = {
		systemPrompt: "Stay concise.",
		messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
	};
	const { promise, resolve } = Promise.withResolvers<CapturedPayload>();
	streamAnthropic(model, context, {
		apiKey: "sk-ant-oat-test",
		isOAuth: true,
		signal: abortedSignal(),
		thinkingEnabled: true,
		reasoning,
		onPayload: payload => resolve(payload as CapturedPayload),
	});
	return promise;
}

describe("Anthropic adaptive effort payload", () => {
	it("emits xhigh effort and summarized thinking for Opus 4.8 at high effort", async () => {
		const payload = await capturePayload(makeAdaptiveModel("claude-opus-4-8"), Effort.High);
		expect(payload.output_config?.effort).toBe("xhigh");
		expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
	});

	it("keeps the legacy 4-tier map and bare adaptive thinking for Opus 4.6", async () => {
		const high = await capturePayload(makeAdaptiveModel("claude-opus-4-6"), Effort.High);
		expect(high.output_config?.effort).toBe("high");
		expect(high.thinking).toEqual({ type: "adaptive" });

		const xhigh = await capturePayload(makeAdaptiveModel("claude-opus-4-6"), Effort.XHigh);
		expect(xhigh.output_config?.effort).toBe("max");
		expect(xhigh.thinking).toEqual({ type: "adaptive" });
	});
});
