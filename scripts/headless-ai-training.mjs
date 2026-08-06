import fs from "node:fs/promises";
import path from "node:path";
import {
  gotoHome,
  launch,
  openSoloModal,
} from "../.claude/skills/run-openfront/driver.mjs";
import { gameState } from "../.claude/skills/run-openfront/game.mjs";
import { shouldRecoverMissingMatch } from "./headless-ai-training-policy.mjs";

const statusPath = path.resolve("data", "headless-ai-training-status.json");
const pollMs = Math.max(
  1_000,
  Number(process.env.OPENFRONT_HEADLESS_POLL_MS ?? 5_000),
);
const rafIntervalMs = Math.max(
  1_000,
  Number(process.env.OPENFRONT_HEADLESS_RAF_MS ?? 5_000),
);
const missingMatchRecoveryPolls = Math.max(
  2,
  Number(process.env.OPENFRONT_HEADLESS_RECOVERY_POLLS ?? 4),
);
let stopping = false;
let browser;
let statusWriteSequence = 0;

async function writeStatus(status) {
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  const temporaryPath = `${statusPath}.${process.pid}.${statusWriteSequence++}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify({ ...status, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await fs.rename(temporaryPath, statusPath);
}

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  await writeStatus({ state: "stopping", signal });
  await browser?.close().catch(() => undefined);
  await writeStatus({ state: "stopped", signal });
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

async function startTraining(page) {
  await gotoHome(page);
  await page.evaluate(() =>
    localStorage.setItem("openfront.headlessAiTraining", "true"),
  );
  await openSoloModal(page);
  const scale = {
    nations: Number(process.env.OPENFRONT_HEADLESS_NATIONS ?? 72),
    tribes: Number(process.env.OPENFRONT_HEADLESS_TRIBES ?? 400),
    map: process.env.OPENFRONT_HEADLESS_MAP ?? "World",
  };
  const started = await page.evaluate((trainingScale) => {
    const modal = document.querySelector("single-player-modal");
    if (typeof modal?.startAiTraining !== "function") return false;
    modal.startAiTraining(trainingScale);
    return true;
  }, scale);
  if (!started) throw new Error("AI training launcher is unavailable");
}

async function main() {
  await writeStatus({
    state: "starting",
    rafIntervalMs,
    pollMs,
    platform: `${process.platform}-${process.arch}`,
  });
  const launched = await launch({
    viewport: { width: 800, height: 600 },
    rafIntervalMs,
    args: [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--mute-audio",
    ],
  });
  browser = launched.browser;
  const page = launched.page;
  await page.addInitScript(() => {
    if (typeof WebGL2RenderingContext === "undefined") return;
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (parameter) {
      const value = original.call(this, parameter);
      return typeof value === "string"
        ? value.replace(
            /swiftshader|llvmpipe|software/gi,
            "HeadlessTrainingGPU",
          )
        : value;
    };
  });
  await startTraining(page);
  let consecutiveMissingPolls = 0;
  while (!stopping) {
    const state = await gameState(page).catch(() => null);
    consecutiveMissingPolls = state === null ? consecutiveMissingPolls + 1 : 0;
    await writeStatus({
      state: state === null ? "waiting-for-match" : "running",
      rafIntervalMs,
      pollMs,
      game: state,
      consecutiveMissingPolls,
    });
    if (
      shouldRecoverMissingMatch(
        consecutiveMissingPolls,
        missingMatchRecoveryPolls,
      )
    ) {
      console.warn(
        `No match state for ${consecutiveMissingPolls} polls; relaunching training`,
      );
      await writeStatus({
        state: "recovering-match",
        rafIntervalMs,
        pollMs,
        consecutiveMissingPolls,
      });
      await startTraining(page);
      consecutiveMissingPolls = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch(async (error) => {
  await writeStatus({
    state: "failed",
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => undefined);
  process.exitCode = 1;
});
