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

sam_path = ROOT / "tests/core/executions/SAMLauncherExecution.test.ts"
sam_text = sam_path.read_text(encoding="utf-8")
for start, target in [((7, 7), (30, 1)), ((7, 8), (35, 1)), ((7, 9), (70, 1))]:
    old = f'''    attacker.buildUnit(UnitType.MIRVWarhead, game.ref({start[0]}, {start[1]}), {{
      targetTile: game.ref({target[0]}, {target[1]}),
    }});
'''
    new = f'''    attacker.buildUnit(UnitType.MIRVWarhead, game.ref({start[0]}, {start[1]}), {{
      targetTile: game.ref({target[0]}, {target[1]}),
      trajectory: [
        {{ tile: game.ref({start[0]}, {start[1]}), targetable: true }},
        {{ tile: game.ref({target[0]}, {target[1]}), targetable: true }},
      ],
    }});
'''
    if sam_text.count(old) != 1:
        raise SystemExit(f"Missing MIRV fixture {start} -> {target}.")
    sam_text = sam_text.replace(old, new, 1)
sam_path.write_text(sam_text, encoding="utf-8")

replace_once(
    "tests/perf/client/DefenseOverlayPerf.ts",
    '      markedForDeletion: id % 97 === 0 ? id : false,\n',
    '      markedForDeletion: id % 97 === 0 ? id : (false as const),\n',
)
