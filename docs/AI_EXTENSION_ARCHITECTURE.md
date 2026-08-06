# AI extension architecture

The visual trainer is an optional client-side extension. It reads OpenFront's
public game-view contracts and emits the same intent events as a human client.
The game engine, unit executions, protocol schemas, and upstream lobby flow stay
unchanged.

## Module communication

Modules communicate through a small typed signal board instead of importing one
another or reaching into `VisualAiTrainer`:

```text
normalized game snapshot
        |
        v
TroopEconomyModule -- reserve/commit/land signals -->
GoldBudgetModule   -- reserve/spend/category signals -->
NavalEconomyModule -- shipyard/factory goal signals -->
        |
        v
AiModuleCoordinator (hold veto, consensus, preferred investment)
        |
        v
VisualAiTrainer adapters (intent events and telemetry)
```

Priority order is deterministic. Each module receives the accumulated readonly
signals from higher-priority modules, then may publish its own signals. The
coordinator resolves those independent recommendations into one consensus while
retaining every module's reason for diagnostics.

Policy math and coordination live in focused files:

- `AiModule.ts`: registry and the default modules.
- `AiModuleCoordinator.ts`: typed signal merging and consensus.
- `AdaptivePortPolicy.ts`: normalized port action, budget, repair, and trade ratios.
- `EconomicIncomePolicy.ts`: recurring-income estimation that excludes windfalls.
- `LandCapacityPolicy.ts`: upstream-derived troop-capacity projections.
- `InfrastructureConnectionPolicy.ts`: legal rail-distance contracts.
- `EconomicSystemPolicy.ts`: city, factory, rail, and trade priorities.
- `NavalStrategicPressurePolicy.ts`: shipyard placement and naval targets.
- `VisualAiTrainer.ts`: OpenFront view/event integration only.

## Land capacity

The human-player land term mirrors the current OpenFront configuration:

```text
2 * (tiles^0.6 * 1,000 + 50,000)
```

Completed city levels add `250,000` each outside that land term. Projections
therefore add only the marginal land gain; they do not multiply existing city
capacity. The `0.6` exponent means land always raises the troop maximum, with
diminishing capacity per additional tile.

## Shipyards and factories

An OpenFront port becomes a train station only when a completed friendly factory
is in train-station range. The extension therefore ranks factory-backed shore
tiles first. If pressure forces an isolated port, the naval module publishes a
`connect-existing-shipyard` goal and the economic builder prioritizes a legal
factory site inside that port's rail catchment.

Port actions are selected from normalized state rather than map-specific
constants:

- factory-connection percentage;
- local naval threat and fleet-coverage percentages;
- damaged-fleet load per dock slot;
- protected-gold coverage of one build cost;
- accessible-partner and connected-port coverage;
- route return as a percentage of build cost;
- transport survival and rail productivity.

Those ratios choose `hold`, `connect`, `defend`, `repair`, or `trade`, then
adapt candidate sampling, site quality, fleet deployment, construction cadence,
repair thresholds, and trade coverage. Only local ships found through the
engine's spatial unit index contribute to coastal pressure; global fleet counts
cannot force a naval plan.

Conquest rewards remain available in the treasury but are filtered out of the
recurring-income estimate. This prevents one-time windfalls from inflating the
economic reserve and blocking an otherwise affordable factory connection.

## Upstream compatibility boundary

- AI context additions are optional so older callers remain valid.
- Modules depend on normalized primitives, not engine implementation classes.
- All actions use existing `BuildUnitIntentEvent`, attack, and navigation
  contracts.
- No core execution or network protocol behavior is changed by this extension.
- Upstream-derived formulas are isolated in `LandCapacityPolicy.ts`, giving an
  upstream update one explicit compatibility point.

The repository retains `upstream` as the official OpenFront remote. This local
fork was imported as a new root commit, so its history currently has no merge
base with `upstream/main`; update work should compare or transplant upstream
commits deliberately rather than running an unrelated-history merge.
