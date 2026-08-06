# AI self-play benchmark

This benchmark tracks nation-AI decision changes with deterministic full-game
simulations. Retain a candidate only when its aggregate result improves across
the fixed seed set and focused behavior tests pass.

## Memory-safe command

```sh
NODE_OPTIONS=--max-old-space-size=512 npm run perf:game -- \
  --ticks 1200 --bots 100 --difficulty impossible --seed ai-safe-a \
  --no-cpu-profile --no-exec-profile --no-gc-profile --no-alloc-profile
```

Run seeds `ai-safe-a`, `ai-safe-b`, and `ai-safe-c` sequentially. Do not run
full World simulations in parallel on memory-constrained mobile devices.

## 2026-07-17: account for committed bot attacks

Candidate: subtract active, non-retreating incoming attack troops from the
normal 4x bot-conquest budget. This avoids repeated attacks and cross-nation
overcommitment against bots that are already being conquered.

| Seed        | Baseline territory | Candidate territory |       Change |
| ----------- | -----------------: | ------------------: | -----------: |
| `ai-safe-a` |              95.9% |               96.9% |      +1.0 pp |
| `ai-safe-b` |              96.3% |               96.1% |      -0.2 pp |
| `ai-safe-c` |              92.7% |               95.5% |      +2.8 pp |
| Mean        |             94.97% |              96.17% | **+1.20 pp** |

Peak JavaScript heap stayed between 56 MB and 64 MB. The candidate was retained.

## Interactive full-match review

Use semantic triggers to pause a real match and inspect its state before
explicitly resuming:

```sh
NODE_OPTIONS=--max-old-space-size=512 npm run perf:game -- \
  --ticks 6000 --bots 20 --nations 6 --difficulty impossible \
  --seed ai-observed-full-1 --max-minutes 6 --interactive \
  --checkpoint-every 1000 --no-cpu-profile --no-exec-profile \
  --no-gc-profile --no-alloc-profile
```

Triggers fire after spawning, at bot survival thresholds (50%, 10%, and 0%),
when the leader crosses 25%, 50%, or 75% of player-owned territory, at the
configured interval, and when the game declares a winner.

### Observed match: `ai-observed-full-1`

- Tick 302: all six nations spawned evenly; no intervention.
- Tick 1302: nations held the top six ranks and 56.4% of territory.
- Tick 2143: half the bots remained; nations held 88.9% and strong reserves.
- Tick 2302: bots were strategically contained; nations held 96.5%.
- Tick 2829: two bots remained and Egypt led with 23.4%.
- Tick 2920: Egypt crossed 25% by taking territory from troop-depleted Sri Lanka.
- Tick 3277: bots were eliminated; Egypt had expanded to 30.6%.
- Tick 3911: Egypt won on the six-minute timer with 161,887 tiles, narrowly
  ahead of Alaska at 156,303. Final hash: `9352188685954390`.

The full game used 38 MB peak JavaScript heap. No AI thresholds were changed:
the checkpoints showed effective bot cleanup, retained troop reserves, and a
leader converting its advantage. Alaska's unconverted late troop surplus is a
candidate for multi-seed investigation, not sufficient evidence by itself.

## Human challenge console

Add `--human-player` to enter the match as `Codex`, a real human-type player.
The console accepts a strategy and attack percentage at each trigger:

- `bank`: stop proactive attacks and retain troops;
- `expand`: take neutral land only;
- `balanced`: expand, then attack only materially weaker reachable players;
- `aggressive`: attack the lowest-density reachable player regardless of
  relative strength.

Actions travel through stamped player intents. Non-adjacent targets use legal
transport-ship intents, structures use construction intents, and incoming
attacks receive retaliation priority. The controller can construct up to eight
cities when owned land and gold permit.

### Challenge: `codex-vs-impossible-1`

Three attempts used the same six Impossible nations, 20 bots, World map, and
six-minute timer:

1. `expand 60` idled in a spawn pocket with no neutral land border. A late
   attack could not recover; eliminated at tick 905.
2. `balanced 45`, later `balanced 25`, reached rank 7 and 33,313 tiles, but
   left 369,600 gold unspent and was eliminated at tick 2,688 by a two-nation
   attack.
3. `balanced 40`, then `balanced 25`, added city construction and reached rank
   6 with 44,941 tiles, a 1.59-million troop cap, and 152,516 troops. After a
   nation attacked, defensive banking and retaliation delayed but did not stop
   elimination at tick 2,604.

Result: the human challenge did **not** beat Impossible AI. The strongest run
showed that early transport breakout, 25% attack pacing, and city investment
were sound, but survival requires diplomacy and stronger defensive tools before
the nation cleanup phase ends.

### Winning challenge: `codex-vs-impossible-4`

The follow-up challenge reduced the board to one full-strength Impossible
nation and ten standard bots without enabling infinite resources. The human
controller gained composable diplomacy and named-attack commands so the
interactive harness could express the same target choices available in the UI.

The winning line used 35% neutral expansion, a temporary alliance with Italy,
30% attacks against intervening bots, and long banking windows. After breaking
the alliance, Codex cleared the route to Italy, waited until Italy's bot wars
reduced its army, then attacked at 75% from a 2.7-to-1 troop advantage. Codex
won at tick 3,761 with 272,846 tiles versus Impossible Italy's 192,438.

The decisive lesson was timing rather than maximum aggression: preserve an
army while the nation spends troops elsewhere, open a land route through weak
states, and commit only after both adjacency and a large troop advantage are
visible.
