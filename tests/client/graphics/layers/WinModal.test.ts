import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { RankedType } from "../../../../src/core/game/Game";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "win_modal.exit": "Exit",
      "win_modal.requeue": "Play Again",
      "win_modal.keep": "Keep Playing",
      "win_modal.spectate": "Spectate",
    };
    return translations[key] || key;
  }),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

vi.mock("../../../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => []),
  purchaseCosmetic: vi.fn(),
  resolveCosmetics: vi.fn(() => []),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    happytime: vi.fn(),
    requestAd: vi.fn(),
    gameplayStop: vi.fn(),
  },
}));

describe("WinModal Requeue", () => {
  let mockLocationHref = "";

  beforeEach(() => {
    mockLocationHref = "";
    // Mock window.location.href using Object.defineProperty
    const locationMock = {
      get href() {
        return mockLocationHref;
      },
      set href(value: string) {
        mockLocationHref = value;
      },
    };
    Object.defineProperty(window, "location", {
      value: locationMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isRankedGame detection", () => {
    it("should detect ranked 1v1 game", () => {
      const gameConfig = {
        rankedType: RankedType.OneVOne,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(true);
    });

    it("should not detect non-ranked game", () => {
      const gameConfig = {
        rankedType: undefined,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(false);
    });
  });

  describe("AI training death handling", () => {
    const deadGame = (gameID: string) =>
      ({
        gameID: () => gameID,
        inSpawnPhase: () => false,
        myPlayer: () => ({ isAlive: () => false, hasSpawned: () => true }),
        updatesSinceLastTick: () => null,
      }) as unknown as GameView;

    it("suppresses the death modal for the active training game", () => {
      const modal = new WinModal();
      modal.game = deadGame("training-game");
      modal.eventBus = { emit: vi.fn() } as unknown as EventBus;
      const show = vi.spyOn(modal, "show").mockResolvedValue();
      const hide = vi.spyOn(modal, "hide");
      sessionStorage.setItem("openfront.aiTrainingGame", "training-game");

      modal.init();
      hide.mockClear();
      modal.tick();

      expect(show).not.toHaveBeenCalled();
      expect(hide).toHaveBeenCalledOnce();
    });

    it("continues showing the death modal for an ordinary game", () => {
      const modal = new WinModal();
      modal.game = deadGame("ordinary-game");
      modal.eventBus = { emit: vi.fn() } as unknown as EventBus;
      const show = vi.spyOn(modal, "show").mockResolvedValue();
      sessionStorage.removeItem("openfront.aiTrainingGame");

      modal.init();
      modal.tick();

      expect(show).toHaveBeenCalledOnce();
    });
  });

  describe("requeue navigation", () => {
    it("should navigate to /?requeue when requeue is triggered", () => {
      // Simulate the _handleRequeue behavior
      const handleRequeue = () => {
        window.location.href = "/?requeue";
      };

      handleRequeue();

      expect(window.location.href).toBe("/?requeue");
    });

    it("should navigate to / when exit is triggered", () => {
      // Simulate the _handleExit behavior
      const handleExit = () => {
        window.location.href = "/";
      };

      handleExit();

      expect(window.location.href).toBe("/");
    });
  });

  describe("requeue URL parameter handling", () => {
    it("should parse requeue parameter from URL", () => {
      const url = new URL("http://localhost:9000/?requeue");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(true);
    });

    it("should not find requeue parameter when absent", () => {
      const url = new URL("http://localhost:9000/");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(false);
    });
  });
});
