/** A lesson counts as completed once 90% of it has been watched. */
export const COMPLETION_THRESHOLD = 0.9;

export interface ProgressUpdate {
  watchedSec: number;
  completed: boolean;
}

/**
 * Merges a progress report from the video player into the stored progress.
 *
 * Watched time never goes backwards (rewinding shouldn't erase progress) and is
 * capped at the lesson length. Completion is sticky: once a lesson is done it
 * stays done, and it is marked done automatically at the 90% threshold.
 */
export function mergeProgress(
  current: ProgressUpdate | undefined,
  reported: { watchedSec: number; completed?: boolean },
  durationSec: number,
): ProgressUpdate {
  const watchedSec = Math.min(Math.max(current?.watchedSec ?? 0, Math.floor(reported.watchedSec)), durationSec);
  const completed =
    (current?.completed ?? false) || reported.completed === true || watchedSec >= durationSec * COMPLETION_THRESHOLD;
  return { watchedSec, completed };
}
