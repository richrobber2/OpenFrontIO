export function shouldRecoverMissingMatch(
  consecutiveMissingPolls,
  recoveryPollThreshold,
) {
  return (
    Number.isFinite(consecutiveMissingPolls) &&
    Number.isFinite(recoveryPollThreshold) &&
    recoveryPollThreshold >= 2 &&
    consecutiveMissingPolls >= recoveryPollThreshold
  );
}
