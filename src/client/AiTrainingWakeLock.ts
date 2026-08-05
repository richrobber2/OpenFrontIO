import "./ai/AdaptiveTrainerBootstrap";

const AI_TRAINING_STORAGE_KEY = "openfront.aiTrainingGame";

let wakeLock: WakeLockSentinel | null = null;
let requestInFlight: Promise<void> | null = null;

function aiTrainingActive(): boolean {
  return localStorage.getItem(AI_TRAINING_STORAGE_KEY) !== null;
}

async function releaseWakeLock(): Promise<void> {
  const current = wakeLock;
  wakeLock = null;
  if (current !== null && !current.released) {
    await current.release();
  }
}

async function acquireWakeLock(): Promise<void> {
  if (
    !aiTrainingActive() ||
    document.visibilityState !== "visible" ||
    !("wakeLock" in navigator) ||
    wakeLock !== null
  ) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (error) {
    console.warn("Unable to acquire AI training screen wake lock", error);
  }
}

async function syncWakeLock(): Promise<void> {
  if (!aiTrainingActive() || document.visibilityState !== "visible") {
    await releaseWakeLock();
    return;
  }
  await acquireWakeLock();
}

function queueSync(): void {
  requestInFlight ??= syncWakeLock().finally(() => {
    requestInFlight = null;
  });
}

export function installAiTrainingWakeLock(): void {
  document.addEventListener("visibilitychange", queueSync);
  window.addEventListener("focus", queueSync);
  window.addEventListener("pagehide", () => {
    void releaseWakeLock();
  });

  // The AI training marker can change without a storage event. Polling once
  // per second is cheap and keeps wake-lock
  // lifetime aligned with the actual training session.
  window.setInterval(queueSync, 1_000);
  queueSync();
}

installAiTrainingWakeLock();
