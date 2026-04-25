# Flood-Fill Finder Detection Study

## Problem / question

Run-map matcher cross-checks are now validated and canonical. The next detector hotspot is flood-fill finder detection. This study focuses only on flood-fill variants with the current legacy flood detector as control.

> Which flood-fill implementation variants preserve legacy flood `FinderEvidence[]` while reducing detector time across all binary view identities?

This is not a matcher study. It intentionally does not run matcher cross-check comparisons, center pruning, row/flood seeded matcher rescue, fused polarity traversal, proposal generation, clustering, or decode.

## Hypothesis / thesis

The current flood detector does two expensive things that can likely be improved without changing output:

1. labels connected components, then scans the whole image again to collect component stats;
2. searches ring/gap/stone relationships with broad component lists.

Candidate implementations should preserve legacy flood output first. Speed only matters for candidates with zero mismatched asset/view rows.

## Designed experiment / study

Run `binary-prefilter-signals` over all selected binary view identities. For each asset/view:

1. materialize the selected `BinaryView`;
2. run `detectFloodFinders(...)` as the legacy flood control;
3. run candidate flood detectors against the same view;
4. compare sorted finder signatures against legacy flood:
   - `source`
   - center x/y
   - module sizes
   - score
5. record timing and output counts for each control/candidate.

Active variants:

| Variant id | Purpose | Behavior requirement |
| --- | --- | --- |
| `legacy-flood-control` | Current flood-fill detector. | Control. |
| `inline-component-stats-flood-prototype` | Combine connected-component labeling and stats collection in one pass instead of label pass + stats pass. | Must match legacy flood output exactly. |
| `filtered-components-flood-prototype` | Prefilter possible rings/gaps/stones before nested containment checks. | Must match legacy flood output exactly. |

Intentionally disabled until this run is analyzed:

- run-map matcher cross-check study;
- legacy matcher comparison;
- center-pruned matcher;
- row/flood-seeded matcher rescue;
- fused normal+inverted matcher traversal;
- proposal generation, clustering, structure, module sampling, and decode.

## Metrics table

| Metric | Unit | Source | Decision use |
| --- | --- | --- | --- |
| Legacy flood duration | ms | `detectFloodFinders` | Control cost. |
| Inline-stats flood duration | ms | `detectFloodFindersWithInlineStats` | Candidate cost. |
| Filtered-components flood duration | ms | `detectFloodFindersWithFilteredComponents` | Candidate cost. |
| Candidate output equality | boolean | finder signature comparison | Primary safety criterion. |
| Candidate mismatch count | asset/view rows | finder signature comparison | Must be zero before considering production. |
| Candidate output count | count | live timing `p=` | Sanity check that speed is not from lost evidence. |

## Decision rule

A candidate is eligible for production implementation only if a full-corpus run reports:

- output equality is `true`;
- mismatch count is `0`;
- measurable speedup over `legacy-flood-control`.

If multiple candidates are safe, prefer the smaller implementation unless the larger candidate has a clear additional win. If a candidate is faster but mismatches, keep it as design input only; do not ship it as a replacement.

Do not make decode or false-positive claims from this study. This study validates flood finder evidence only.

## Implementation checklist

- [x] Keep all 54 binary view identities available with `--view-set all`.
- [x] Turn off matcher/run-map comparison for this study direction.
- [x] Turn off row-scan/flood/matcher proposal generation for this study direction.
- [x] Add legacy flood control timing.
- [x] Add inline component-stats candidate.
- [x] Add filtered component-candidate candidate.
- [x] Emit processed summary fields for flood control/candidate comparison.
- [ ] Run the full 203-asset corpus.
- [ ] Analyze candidate equality and speedup before production changes.

## Reports

Raw full reports are ignored and live under:

```text
tools/bench/reports/full/study/study-binary-prefilter-signals.json
```

The durable processed summary lives under:

```text
tools/bench/reports/study/study-binary-prefilter-signals.summary.json
```

The processed summary should be the first artifact to read. It includes:

- `headline`: detector/flood control timing plus candidate equality/mismatch counts;
- `variants`: only the active flood control/candidates;
- `floodMatrix`: compact control/candidate timing, saved ms, improvement %, output equality, and mismatch counts;
- `matcherMatrix`: expected to be `null` for this flood-focused run;
- `questionCoverage`: states flood evidence preservation and decode/false-positive scope.

## Full-run plan

Run the full corpus with no `--max-assets`:

```bash
bun run --cwd tools/bench bench study binary-prefilter-signals \
  --view-set all \
  --refresh-cache
```

Expected decision after the run:

- If `inline-component-stats-flood-prototype` has zero mismatches and meaningful speedup, promote the one-pass label+stats design.
- If `filtered-components-flood-prototype` has zero mismatches and meaningful speedup, consider it as a smaller production cleanup.
- If both mismatch, keep legacy flood and design a more conservative component-label reuse study.
- After flood evidence is settled, run decode/proposal studies separately before claiming end-to-end accuracy or false-positive impact.
