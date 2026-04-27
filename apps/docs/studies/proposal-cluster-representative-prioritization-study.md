# Proposal Cluster Representative Prioritization Study

## Problem / question

After proposal ranking and no-flood canonization, most remaining scanner time is spent trying clustered proposal representatives through structure, sampling, and decode. This study asks whether choosing better representatives inside each near-duplicate proposal cluster reduces decode work or improves decode outcomes without deleting candidates or changing QR decode internals.

## Hypothesis / thesis

The highest global proposal score is not always the best representative inside a cluster. Prioritizing representatives by timing, quiet-zone, alignment, or view diversity may try a decodable representative earlier while preserving the same cluster frontier. The null hypothesis is that current proposal-score ordering is already optimal, or that alternative ordering loses positives / increases false positives.

## Designed experiment / study

Run:

```bash
bun run bench study proposal-cluster-representative-prioritization --refresh-cache
```

Default variants:

| Variant | Purpose |
| --- | --- |
| `proposal-score` | Current representative ordering control. |
| `timing-score` | Prefer representatives with strongest grid timing-line support. |
| `quiet-timing-score` | Prefer quiet-zone + timing + alignment evidence. |
| `decode-signal-score` | Strongest decode-likelihood representative score. |
| `view-diverse-score` | Prefer view-family diversity before proposal score when multiple reps are allowed. |

Defaults:

```text
detectorPolicy=no-flood
rankingVariant=timing-heavy
geometryVariant=baseline
maxProposals=24
maxClusterRepresentatives=1
maxDecodeAttempts=unbounded by default
maxViews=54
allowMultiple=false
continueAfterDecode=false
```

Pass `--max-decode-attempts N` only when explicitly studying bounded production budgets.

## Metrics table

| Metric | Unit | Decision use |
| --- | --- | --- |
| Positive decoded assets | assets | Primary recall guard. |
| False-positive assets | assets | Safety guard. |
| Lost/gained positive asset ids | asset ids | Explain representative-order regressions/improvements. |
| Cluster count / processed representatives | count | Frontier work after representative ordering. |
| Decode attempts / successes | count | Decode effort and outcome. |
| Structure, geometry, module-sampling, decode timings | ms | Cost attribution. |

## Decision rule

Advance a representative ordering variant only if, relative to `proposal-score`:

```text
lost positive asset ids = []
false-positive asset delta <= 0
positive decoded asset delta >= 0
decode attempts and/or scan time improve materially
```

If using `maxClusterRepresentatives=1`, this tests which single cluster representative should be tried. If using a higher representative budget, also inspect whether `view-diverse-score` reduces attempts by avoiding near-duplicate representatives.

## Results

Pending.

## Conclusion / evidence-backed decision

Pending generated study evidence.
