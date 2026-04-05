import type { AsyncJob } from "../../../async/job-manager";

export type ProcessStatus = AsyncJob["status"];

export interface ProcessEntry {
	id: string;
	type: "bash" | "task";
	status: ProcessStatus;
	label: string;
	startTime: number;
	/** Duration in ms. For running jobs: elapsed time; for finished jobs: time from start to end. */
	durationMs: number;
	resultText?: string;
	errorText?: string;
}

/** Convert an AsyncJob to a ProcessEntry with computed duration. */
export function toProcessEntry(job: AsyncJob): ProcessEntry {
	// For running jobs, compute elapsed time live; for finished jobs use the recorded end time.
	const durationMs = job.endTime !== undefined ? job.endTime - job.startTime : Date.now() - job.startTime;
	return {
		id: job.id,
		type: job.type,
		status: job.status,
		label: job.label,
		startTime: job.startTime,
		durationMs,
		resultText: job.resultText,
		errorText: job.errorText,
	};
}
