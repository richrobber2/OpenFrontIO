const healthUrl = process.env.OPENFRONT_HEALTH_URL ?? "http://127.0.0.1:3000/api/health";
const timeoutMs = Number.parseInt(
  process.env.OPENFRONT_STARTUP_TIMEOUT_MS ?? "60000",
  10,
);
const retryDelayMs = 250;
const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(healthUrl);
    if (response.ok) {
      console.log(`Dev server ready at ${healthUrl}`);
      process.exit(0);
    }
  } catch {
    // The master or workers are still starting. Retry quietly.
  }

  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
}

console.error(`Timed out waiting for dev server at ${healthUrl}`);
process.exit(1);
