# Proposal Ranking Decode Confirmation Study

## Problem / question

The geometry decode run showed that hard proposal rejection can gain positives under bounded search, but can also lose an easy baseline positive. This study asks whether reordering proposals with stronger decode-likelihood signals improves decode work without deleting candidates.

## Hypothesis / thesis

Ranking candidates with stronger timing, quiet-zone, and alignment weights should try decodable proposals earlier than the baseline score. The null hypothesis is that the current ranking is already best, or that stronger decode-signal weighting loses positives or increases false positives.

## Designed experiment / study

Run:

```bash
bun run bench study proposal-ranking-decode-confirmation --refresh-cache
```

Default variants:

| Variant | Purpose |
| --- | --- |
| `baseline` | Current canonical proposal ranking. |
| `timing-heavy` | Increases grid timing-line score weight. |
| `quiet-timing-heavy` | Increases quiet-zone, timing, and alignment evidence. |
| `decode-signal-heavy` | Strongest decode-likelihood weighting; downweights detector prior and increases penalties. |

Defaults:

```text
detectorPolicy=no-flood
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
| Lost/gained positive asset ids | asset ids | Explain rank regressions/improvements. |
| Cluster count / processed representatives | count | Frontier work after ranking. |
| Decode attempts / successes | count | Decode effort and outcome. |
| Ranking, structure, geometry, module-sampling, decode timings | ms | Cost attribution. |

## Decision rule

Advance a ranking variant only if, relative to `baseline`:

```text
lost positive asset ids = []
false-positive asset delta <= 0
positive decoded asset delta >= 0
decode attempts and/or scan time improve materially
```

If using a bounded `--max-decode-attempts`, treat gains as budget-ordering evidence, not proposal-set coverage evidence.

## Results

Pending.

## Conclusion / evidence-backed decision

Pending generated study evidence.
