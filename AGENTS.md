# Repository agent rules

## Performance evidence

Every change that can affect runtime behavior must include a proportional,
repeatable performance check. Use the smallest useful form: a microbenchmark,
budget assertion, representative load test, frame/tick timing, allocation
measurement, payload-size check, or before/after browser profile.

- Record the workload, before/after values, units, and environment.
- Prefer deterministic scripts under `tests/perf/` and expose reusable checks
  through an `npm run perf:*` command.
- Test the constrained resource directly (CPU, frame time, memory, network,
  storage, GPU uploads/draws, or startup time).
- Do not complete the linked task or commit a runtime change without running
  and reporting its performance check.
- Run `npm run perf:coverage` before committing. It rejects changed runtime
  files and functions without entries in `tests/perf/function-coverage.json`.
- Use `npm run perf:coverage:all` to inventory coverage across the complete
  runtime tree; use `npm run perf:coverage:all:strict` to fail on any global gap.
- Documentation, comments, formatting, and test-only changes may state
  `no runtime impact` instead of adding a benchmark.

Performance evidence complements correctness tests; it does not replace them.
