---
name: study-analyze
description: Analyze a generated benchmark study report and extract evidence-backed recommendations. Use when reading tools/bench/reports/study-*.json or comparing study runs.
---

# Study Analyze

Use this after a study report has been generated.

## Workflow

1. **Load the report**
   - Read `tools/bench/reports/study-<id>.json`.
   - Record generated timestamp, git commit, dirty state, corpus size, filters, seed, cache hits/misses, and study config.

2. **Validate report fitness**
   - Confirm the report measured the intended corpus and all required variants.
   - Check whether cache hits make the run unsuitable for timing analysis.
   - Check whether arbitrary caps were active when the question needs exhaustive evidence.

3. **Compute headline outcomes**
   - Positive pass/fail counts.
   - Negative false-positive counts.
   - Unique successful contributors by decision unit.
   - Overlap matrix or greedy coverage order.

4. **Separate capability from cost**
   - Capability: unique positives, total positives, false positives, confidence scores.
   - Cost: materialization, proposal generation, clustering, structure, module sampling, decode attempts.
   - Treat nested timing spans as nested; do not sum parent and child spans as independent time.

5. **Derive budget evidence**
   - Use first-success rank distributions for cluster/decode budgets.
   - Report p50, p90, p95, max, and recall retained at candidate budgets.
   - Identify assets lost by each proposed budget.

6. **Produce recommendations**
   - Mandatory inclusions first.
   - Then order overlapping contributors by marginal capability per cost.
   - Explicitly list exclusions and why.

7. **Update study documentation**
   - Fill `apps/docs/studies/<study-id>.md` Results and Interpretation sections.
   - Link report path and commit.

## Output

Return:
- validation notes;
- outcome summary;
- mandatory inclusions;
- recommended order/budget;
- slowest bottlenecks;
- documentation updates needed.
