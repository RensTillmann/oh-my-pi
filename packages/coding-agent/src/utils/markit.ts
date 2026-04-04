import { untilAborted } from "@oh-my-pi/pi-utils";
import { ToolAbortError } from "../tools/tool-errors";

export interface MarkitConversionResult {
	content: string;
	ok: boolean;
	error?: string;
}

type StreamInfo = {
	extension: string;
	filename: string;
};

interface MarkitLike {
	convertFile(filePath: string): Promise<{ markdown?: string }>;
	convert(buffer: Buffer, streamInfo: StreamInfo): Promise<{ markdown?: string }>;
}

let markitPromise: Promise<MarkitLike> | null = null;
async function getMarkit(): Promise<MarkitLike> {
	if (!markitPromise) {
		markitPromise = import("markit-ai").then(mod => {
			const MarkitCtor = (mod as { Markit: new () => MarkitLike }).Markit;
			return new MarkitCtor();
		});
	}
	return markitPromise;
}

function normalizeExtension(extension: string): string {
	const trimmed = extension.trim().toLowerCase();
	if (!trimmed) return ".bin";
	return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function normalizeError(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message.trim();
	}
	return "Conversion failed";
}

async function runMarkitConversion<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	try {
		return signal ? await untilAborted(signal, task) : await task();
	} catch (error) {
		if (error instanceof ToolAbortError) {
			throw error;
		}
		if (error instanceof Error && error.name === "AbortError") {
			throw new ToolAbortError();
		}
		throw error;
	}
}

function finalizeConversion(markdown?: string): MarkitConversionResult {
	if (typeof markdown === "string" && markdown.length > 0) {
		return { content: markdown, ok: true };
	}

	return { content: "", ok: false, error: "Conversion produced no output" };
}

export async function convertFileWithMarkit(filePath: string, signal?: AbortSignal): Promise<MarkitConversionResult> {
	try {
		const markit = await getMarkit();
		const result = await runMarkitConversion(() => markit.convertFile(filePath), signal);
		return finalizeConversion(result.markdown);
	} catch (error) {
		if (error instanceof ToolAbortError) {
			throw error;
		}
		return { content: "", ok: false, error: normalizeError(error) };
	}
}

export async function convertBufferWithMarkit(
	buffer: Uint8Array,
	extension: string,
	signal?: AbortSignal,
): Promise<MarkitConversionResult> {
	const normalizedExtension = normalizeExtension(extension);
	const streamInfo: StreamInfo = {
		extension: normalizedExtension,
		filename: `input${normalizedExtension}`,
	};

	try {
		const markit = await getMarkit();
		const result = await runMarkitConversion(() => markit.convert(Buffer.from(buffer), streamInfo), signal);
		return finalizeConversion(result.markdown);
	} catch (error) {
		if (error instanceof ToolAbortError) {
			throw error;
		}
		return { content: "", ok: false, error: normalizeError(error) };
	}
}
