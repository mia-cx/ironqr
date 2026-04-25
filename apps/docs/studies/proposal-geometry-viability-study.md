# Proposal Geometry Viability Study

## Problem / question

Finder triples are currently filtered by coarse triangle geometry. Highly stylized, perspective-warped, or distorted QR codes make location-only geometry noisy, but finder evidence also carries horizontal and vertical module-size estimates. This study asks whether aspect/scale consistency can improve proposal realism without losing positive proposal coverage.

The production change under study is semantic finder-triple scoring/filtering during proposal assembly, not detector selection, early exits, or proposal budgets.

## Hypothesis / thesis

Finder triples whose aligned finders have contradictory local aspect ratios or scale estimates are often low-signal combinations. Soft penalties may push them below realistic triples, and conservative hard rejection may remove nonsense triples without losing useful proposal coverage.

Null hypothesis: current baseline geometry remains necessary because aspect/scale variants either lose positive proposal coverage or only reshuffle the frontier without useful reduction.

## Designed experiment / study

Run:

```bash
bun run --cwd tools/bench bench study proposal-geometry-viability --detector-policy no-flood
```

The study uses canonical proposal assembly (`no-allocation-score`) and the `no-flood` detector policy. Every variant scores the normal finder evidence and uses the normal proposal caps. It does not introduce early exits, evidence budgets, view skipping, or fallback gating.

Variants:

| Variant | Behavior | Question answered |
| --- | --- | --- |
| `baseline` | Current canonical geometry score/filter. | Control. |
| `aspect-penalty` | Penalize aligned finder pairs whose `log(hModuleSize / vModuleSize)` signs/magnitudes disagree. | Does aspect consistency improve frontier realism without hard rejection? |
| `aspect-reject-conservative` | Hard-reject only extreme opposite aspect contradictions. | Can obvious aspect contradictions be filtered safely? |
| `scale-consistency-penalty` | Penalize aligned finder pairs with inconsistent module/h/v scale estimates. | Does local scale consistency provide useful ranking signal? |
| `aspect-scale-penalty` | Combined aspect and scale penalty. | Do the two realism signals compose? |

Default corpus: all approved assets, all default binary views.

## Metrics table

| Metric | Unit | Decision use |
| --- | --- | --- |
| Positive proposal asset coverage | assets | Mandatory recall guard. |
| Negative proposal asset coverage | assets | Safety/frontier-shape guard. |
| Proposal count delta | proposals | Measures frontier shrink/expansion. |
| Triple count delta | triples | Measures semantic filtering effect. |
| Proposal signature mismatch assets | assets | Expected for semantic variants, but scopes frontier change. |
| Proposal count mismatch assets | assets | Coarse frontier divergence. |
| Lost/gained positive asset ids | asset ids | Explains recall changes. |
| `tripleAssemblyMs` | ms | Assembly cost impact. |
| `proposalConstructionMs` | ms | Proposal object construction impact. |
| Detector timings | ms | Confirm detector work is unchanged across variants. |

## Decision rule

Advance a soft-scoring variant only if:

```text
positive proposal asset delta = 0
lost positive asset ids = []
negative proposal behavior is not worse
proposal frontier change is explainable
```

Advance a hard-reject variant only if:

```text
positive proposal asset delta = 0
lost positive asset ids = []
triple/proposal reduction is meaningful
follow-up decode confirmation accepts the reduced frontier
```

Do not canonize semantic filtering from proposal-only evidence if proposal signatures change. Use this study to select decode-confirmation candidates.

## Results

Full proposal-only geometry run generated `2026-04-25T22:32:17.278Z` from commit `e49f2d09e6ead5ccc0e051300e6d23e6273f073c` with dirty working tree state. Reports:

```text
tools/bench/reports/full/study/study-proposal-geometry-viability.json
tools/bench/reports/study/study-proposal-geometry-viability.summary.json
```

Run shape:

```text
assets=203 positives=60 negatives=143
detectorPolicyId=no-flood maxViews=54 maxProposals=24
cache hits=0 misses=406 writes=203
```

| Variant | Pos assets with proposals | Neg assets with proposals | Proposals | Triples | Signature-mismatch assets | Count-mismatch assets | Triple assembly ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `baseline` | 60 | 143 | 168,366 | 540,894 | 0 | 0 | 404.17 |
| `aspect-penalty` | 60 | 143 | 168,366 | 540,894 | 144 | 0 | 461.36 |
| `aspect-reject-conservative` | 60 | 143 | 160,996 | 497,005 | 186 | 149 | 488.11 |
| `scale-consistency-penalty` | 60 | 143 | 168,366 | 540,894 | 127 | 0 | 469.53 |
| `aspect-scale-penalty` | 60 | 143 | 168,366 | 540,894 | 158 | 0 | 445.54 |

All variants preserved asset-level positive proposal coverage (`60/60`) and negative proposal-asset behavior (`143/143`). The soft penalties changed proposal ordering/signatures without changing proposal counts. `aspect-reject-conservative` reduced the frontier by `7,370` proposals (`4.38%`) and `43,889` triples (`8.11%`) while preserving asset-level proposal coverage.

Largest `aspect-reject-conservative` proposal reductions included:

```text
asset-66fd3d030cd7b6f6 -NEG: -215 proposals, -707 triples
asset-43d79ea0fc29f9e1 -NEG: -161 proposals, -365 triples
asset-bd1e51041cfe8d77 +QR:  -160 proposals, -433 triples
asset-a443559fe831be16 -NEG: -154 proposals, -266 triples
asset-53cd380c4515b85b -NEG: -149 proposals, -347 triples
```

## Interpretation plan

First compare asset-level proposal coverage against `baseline`. No variant lost a positive asset, so all remain viable for follow-up. The soft penalties are ranking/frontier-shape candidates: they changed proposal signatures on many assets but did not reduce count. `aspect-reject-conservative` is the only variant that materially reduces triples/proposals, but because it removes triples it requires decode confirmation before production use.

The timing data should not drive promotion: semantic penalties add triple-scoring work (`+41ms` to `+84ms` triple assembly), while scan-time decreases are dominated by detector/view timing variance from rerunning each variant.

## Conclusion / evidence-backed decision

Advance `aspect-reject-conservative` to decode confirmation as the geometry realism filter candidate: it preserved proposal asset coverage and removed `43,889` triples / `7,370` proposals. Do not canonize it from proposal-only data.

Keep `aspect-scale-penalty` as the soft scoring backup because it combines both signals and had lower added assembly cost than the individual soft penalties in this run. Bin standalone `aspect-penalty` and `scale-consistency-penalty` unless later decode evidence specifically needs them.
