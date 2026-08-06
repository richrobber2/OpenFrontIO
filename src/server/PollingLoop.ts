import { logger } from "./Logger";

const log = logger.child({ comp: "polling" });

/**
 * Starts a polling loop that executes the given async task effectively recursively using setTimeout.
 * This guarantees that the next execution only starts after the previous one has completed (or failed),
 * preventing request pile-ups.
 *
 * Local development is standalone by default and does not run the API service
 * used by matchmaking and other background tasks. Set ENABLE_BACKGROUND_POLLING=true
 * when intentionally running the complete local service stack.
 *
 * @param task The async function to execute.
 * @param intervalMs The delay in milliseconds before the next execution.
 */
export function startPolling(task: () => Promise<void>, intervalMs: number) {
  if (
    process.env.GAME_ENV === "dev" &&
    process.env.ENABLE_BACKGROUND_POLLING !== "true"
  ) {
    return;
  }

  const runLoop = () => {
    task()
      .catch((error) => {
        log.error("Error in polling loop:", error);
      })
      .finally(() => {
        setTimeout(runLoop, intervalMs);
      });
  };
  runLoop();
}
