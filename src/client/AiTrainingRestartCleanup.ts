const AI_TRAINING_KEY = "openfront.aiTrainingGame";

function disposeWebGLCanvas(canvas: HTMLCanvasElement): void {
  try {
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const loseContext = gl?.getExtension("WEBGL_lose_context");
    loseContext?.loseContext();
  } catch (error) {
    console.warn("Failed to release stale AI training WebGL context", error);
  }
  canvas.remove();
}

export function wipeAiTrainingMap(): void {
  if (!localStorage.getItem(AI_TRAINING_KEY)) return;

  document
    .querySelectorAll<HTMLCanvasElement>("#webgl-debug-canvas")
    .forEach(disposeWebGLCanvas);
  document
    .querySelectorAll("#game-input-overlay")
    .forEach((node) => node.remove());

  const app = document.getElementById("app");
  app?.replaceChildren();

  document.body.classList.remove("in-game");
}

export function installAiTrainingRestartCleanup(): void {
  document.addEventListener("restart-ai-training", wipeAiTrainingMap, {
    capture: true,
  });
}
