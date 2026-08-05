from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()


def replace_once(path: str, old: str, new: str) -> None:
    file_path = ROOT / path
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"Expected exactly one compatibility target in {path}; found {count}."
        )
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/client/AiTrainingRestartCleanup.ts",
    '''    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
''',
    '''    const gl =
      canvas.getContext("webgl2") ?? canvas.getContext("webgl");
''',
)

replace_once(
    "src/client/ClientGameRunner.ts",
    '''    this.myPlayer.actions(tile, [UnitType.TransportShip]).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
          ),
        );
''',
    '''    const myPlayer = this.myPlayer;
    const attackRatio = this.renderer.uiState.attackRatio;
    myPlayer.actions(tile, [UnitType.TransportShip]).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            myPlayer.troops() * attackRatio,
          ),
        );
''',
)
replace_once(
    "src/client/ClientGameRunner.ts",
    '''    this.myPlayer.actions(tile, null).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.renderer.uiState.attackRatio,
          ),
        );
''',
    '''    const myPlayer = this.myPlayer;
    const attackRatio = this.renderer.uiState.attackRatio;
    myPlayer.actions(tile, null).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            myPlayer.troops() * attackRatio,
          ),
        );
''',
)

replace_once(
    "src/client/ai/AdaptiveTrainingController.ts",
    '    return this.list().at(-1) ?? null;\n',
    '''    const checkpoints = this.list();
    return checkpoints[checkpoints.length - 1] ?? null;
''',
)
replace_once(
    "src/client/ai/AdaptiveTrainingController.ts",
    '''      id === undefined
        ? checkpoints.at(-2) ?? checkpoints.at(-1)
        : checkpoints.find((candidate) => candidate.id === id);
''',
    '''      id === undefined
        ? checkpoints[checkpoints.length - 2] ??
          checkpoints[checkpoints.length - 1]
        : checkpoints.find((candidate) => candidate.id === id);
''',
)

replace_once(
    "src/client/ai/VisualAiTrainer.ts",
    '''          const sourceWaterComponents = new Set(
            this.game
              .neighbors(tile)
              .filter((neighbor) => this.game.isWater(neighbor))
              .map((neighbor) => this.game.getWaterComponent(neighbor))
              .filter((component): component is number => component !== null),
          );
          const reachablePorts = partnerPorts.filter((partner) =>
            [...sourceWaterComponents].some((component) =>
              this.game.hasWaterComponent(partner.tile(), component),
            ),
          );
''',
    '''          // GameView exposes terrain but not the simulation's mutable
          // water-component graph. Restrict projected trade to ocean shores,
          // which are guaranteed to be navigable, instead of inventing inland
          // lake connectivity in the client planner.
          const reachablePorts = this.game.isOceanShore(tile)
            ? partnerPorts.filter((partner) =>
                this.game.isOceanShore(partner.tile()),
              )
            : [];
''',
)
replace_once(
    "src/client/ai/VisualAiTrainer.ts",
    '          route: ReturnType<VisualAiTrainer["strategicRouteAssessment"]>;\n',
    '''          route: NonNullable<
            ReturnType<VisualAiTrainer["strategicRouteAssessment"]>
          >;
''',
)
replace_once(
    "src/client/ai/VisualAiTrainer.ts",
    '''      const weaponCandidates = [
        { kind: "nuke" as const, type: UnitType.AtomBomb },
        { kind: "nuke" as const, type: UnitType.HydrogenBomb },
      ];
''',
    '''      const weaponCandidates: ReadonlyArray<{
        kind: "nuke";
        type: PlayerBuildableUnitType;
      }> = [
        { kind: "nuke", type: UnitType.AtomBomb },
        { kind: "nuke", type: UnitType.HydrogenBomb },
      ];
''',
)
replace_once(
    "src/client/ai/VisualAiTrainer.ts",
    '        increment: this.game.config().defaultNukeSpeed(),\n',
    '        increment: this.game.config().nukeSpeed(UnitType.AtomBomb),\n',
)
replace_once(
    "src/client/ai/VisualAiTrainer.ts",
    '''  private activeGene(gene: "Aggression" | "Caution" | "Naval"): number {
    return this.learning.candidateActive === 1
      ? this.learning[`candidate${gene}Gene`]
      : this.learning[`${gene.toLowerCase()}Gene` as keyof LearningProfile];
  }
''',
    '''  private activeGene(gene: "Aggression" | "Caution" | "Naval"): number {
    switch (gene) {
      case "Aggression":
        return this.learning.candidateActive === 1
          ? this.learning.candidateAggressionGene
          : this.learning.aggressionGene;
      case "Caution":
        return this.learning.candidateActive === 1
          ? this.learning.candidateCautionGene
          : this.learning.cautionGene;
      case "Naval":
        return this.learning.candidateActive === 1
          ? this.learning.candidateNavalGene
          : this.learning.navalGene;
    }
  }
''',
)

(ROOT / "scripts/headless-ai-training-policy.d.mts").write_text(
    '''export function shouldRecoverMissingMatch(
  consecutiveMissingPolls: number,
  recoveryPollThreshold: number,
): boolean;
''',
    encoding="utf-8",
)

replace_once(
    "tests/core/executions/SAMLauncherExecution.test.ts",
    '''  test("SAM intercepts every MIRV warhead aimed within its local protection radius", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));
    attacker.buildUnit(UnitType.MIRVWarhead, game.ref(7, 7), {
      targetTile: game.ref(30, 1),
    });
    attacker.buildUnit(UnitType.MIRVWarhead, game.ref(7, 8), {
      targetTile: game.ref(35, 1),
    });
    attacker.buildUnit(UnitType.MIRVWarhead, game.ref(7, 9), {
      targetTile: game.ref(70, 1),
    });

    executeTicks(game, 3);

    const survivingTargets = attacker
      .units(UnitType.MIRVWarhead)
      .map((warhead) => warhead.targetTile());
    expect(survivingTargets).toEqual([game.ref(70, 1)]);
    expect(sam.isInCooldown()).toBe(true);
  });
''',
    '''  test("SAM intercepts every MIRV warhead aimed within its local protection radius", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    sam.increaseLevel();
    sam.reloadMissile();
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    attacker.buildUnit(UnitType.MIRVWarhead, game.ref(7, 7), {
      targetTile: game.ref(30, 1),
      trajectory: [
        { tile: game.ref(7, 7), targetable: false },
        { tile: game.ref(10, 7), targetable: false },
        { tile: game.ref(15, 5), targetable: true },
        { tile: game.ref(20, 3), targetable: true },
        { tile: game.ref(25, 2), targetable: true },
        { tile: game.ref(30, 1), targetable: true },
      ],
    });
    attacker.buildUnit(UnitType.MIRVWarhead, game.ref(7, 8), {
      targetTile: game.ref(35, 1),
      trajectory: [
        { tile: game.ref(7, 8), targetable: false },
        { tile: game.ref(11, 7), targetable: false },
        { tile: game.ref(16, 6), targetable: true },
        { tile: game.ref(22, 4), targetable: true },
        { tile: game.ref(29, 2), targetable: true },
        { tile: game.ref(35, 1), targetable: true },
      ],
    });
    attacker.buildUnit(UnitType.MIRVWarhead, game.ref(7, 9), {
      targetTile: game.ref(100, 1),
      trajectory: [
        { tile: game.ref(7, 9), targetable: false },
        { tile: game.ref(60, 10), targetable: true },
        { tile: game.ref(90, 5), targetable: true },
        { tile: game.ref(100, 1), targetable: true },
      ],
    });

    executeTicks(game, 3);

    const survivingTargets = attacker
      .units(UnitType.MIRVWarhead)
      .map((warhead) => warhead.targetTile());
    expect(survivingTargets).toEqual([game.ref(100, 1)]);
    expect(sam.isInCooldown()).toBe(true);
  });
''',
)

replace_once(
    "tests/perf/client/DefenseOverlayPerf.ts",
    '      markedForDeletion: id % 97 === 0 ? id : false,\n',
    '      markedForDeletion: id % 97 === 0 ? id : (false as const),\n',
)
