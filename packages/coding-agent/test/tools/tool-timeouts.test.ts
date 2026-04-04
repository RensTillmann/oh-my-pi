import { describe, expect, it } from "bun:test";
import { clampTimeout } from "@oh-my-pi/pi-coding-agent/tools/tool-timeouts";

describe("clampTimeout", () => {
	describe("bash (default: 0 = no timeout)", () => {
		it("returns 0 when no argument given (default: no timeout)", () => {
			expect(clampTimeout("bash")).toBe(0);
		});

		it("returns 0 for explicit 0 (bypasses min=1 sentinel)", () => {
			expect(clampTimeout("bash", 0)).toBe(0);
		});

		it("returns 0 for negative values", () => {
			expect(clampTimeout("bash", -1)).toBe(0);
			expect(clampTimeout("bash", -100)).toBe(0);
		});

		it("clamps sub-minimum positive values up to min=1", () => {
			expect(clampTimeout("bash", 0.5)).toBe(1);
		});

		it("passes through values in the normal range unchanged", () => {
			expect(clampTimeout("bash", 1)).toBe(1);
			expect(clampTimeout("bash", 30)).toBe(30);
			expect(clampTimeout("bash", 3600)).toBe(3600);
		});

		it("clamps values above max=3600 down to 3600", () => {
			expect(clampTimeout("bash", 9999)).toBe(3600);
		});
	});

	describe("tools with non-zero defaults", () => {
		it("returns the tool default when no argument given", () => {
			expect(clampTimeout("python")).toBe(30);
			expect(clampTimeout("fetch")).toBe(20);
			expect(clampTimeout("ssh")).toBe(60);
		});

		it("still returns 0 for explicit 0 regardless of tool default", () => {
			expect(clampTimeout("python", 0)).toBe(0);
			expect(clampTimeout("fetch", 0)).toBe(0);
		});
	});
});
