from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"Expected exactly one migration overlap in {path}; found {count}."
        )
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# A named import executes SinglePlayerModal's registration side effects too.
replace_once(
    "src/client/Main.ts",
    'import "./SinglePlayerModal";\n',
    "",
)

# Keep the private stale-lobby guard and the upstream game-starting notification.
replace_once(
    "src/client/Main.ts",
    '''    this.lobbyHandle.prestart.then(() => {
      // The game is actually starting now (lobby wait is over). Let listeners that stay up
      // through the wait (e.g. the featured-stream panel) hide at this point instead of on join.
      document.dispatchEvent(new CustomEvent("game-starting"));
    newLobbyHandle.prestart.then(() => {
      if (this.lobbyHandle !== newLobbyHandle) return;
''',
    '''    newLobbyHandle.prestart.then(() => {
      if (this.lobbyHandle !== newLobbyHandle) return;
      // The game is actually starting now (lobby wait is over). Let listeners that stay up
      // through the wait (e.g. the featured-stream panel) hide at this point instead of on join.
      document.dispatchEvent(new CustomEvent("game-starting"));
''',
)

# Wait for Steam name seeding, retain the AI fallback name, and skip ads in training.
replace_once(
    "src/client/SinglePlayerModal.ts",
    '''    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;

    // Wait for the one-shot Steam name-seed to settle before reading
    // getUsername(), so a fast single-player start uses the Steam persona
    // rather than the interim generated anon name. Always resolves.
    await usernameInput?.whenSeeded();

    await crazyGamesSDK.requestMidgameAd();
    ) as UsernameInput | null;
    const enteredUsername = usernameInput?.getUsername().trim();
''',
    '''    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;

    // Wait for the one-shot Steam name-seed to settle before reading
    // getUsername(), so a fast single-player start uses the Steam persona
    // rather than the interim generated anon name. Always resolves.
    await usernameInput?.whenSeeded();

    const enteredUsername = usernameInput?.getUsername().trim();
''',
)

# Keep the larger mobile top-bar clearance without duplicating an HTML attribute.
replace_once(
    "src/client/components/PlayPage.ts",
    '''            class="lg:hidden h-[calc(env(safe-area-inset-top)+56px)] -mb-4"
            class="lg:hidden h-[calc(env(safe-area-inset-top)+64px)] lg:col-span-2 -mb-4"
''',
    '''            class="lg:hidden h-[calc(env(safe-area-inset-top)+64px)] -mb-4"
''',
)
