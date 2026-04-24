---
name: study-design
description: Design an evidence-backed benchmark study before implementation. Use when adding or changing a study, deciding what to measure, or turning a product/performance question into a reproducible experiment.
---

# Study Design

Use this when a study needs a clear question, instrumentation plan, and decision rule before code changes.

## Workflow

1. **State the problem / question**
   - Write the exact decision the study should inform.
   - Identify the unit of decision: view, scalar, threshold, cluster, asset, engine, budget, etc.
   - Name what would change in production if the study answers clearly.

2. **Write the hypothesis / thesis**
   - Describe the expected relationship between capability and cost.
   - Include the null hypothesis: what result means “do not change production behavior.”

3. **Design the experiment**
   - Choose corpus filters and explain why they are representative.
   - List every metric required to answer the question.
   - Separate nested timings from independent wall-clock timings.
   - Define cache behavior and random seeds.
   - Remove arbitrary caps unless the cap itself is under study.

4. **Define decision rules before running**
   - Mandatory inclusion rules, e.g. “include every view uniquely decoding a positive asset.”
   - Tie-breakers, e.g. marginal decodes per millisecond, confidence, false positives.
   - Budget rules, e.g. p95 successful cluster rank, all-success max rank, or chosen recall target.

5. **Document the study**
   - Create or update `apps/docs/studies/<study-id>.md` with:
     - Problem / question
     - Hypothesis / thesis
     - Designed experiment / study
     - Results placeholder
     - Interpretation plan
     - Conclusion / evidence-backed decision placeholder

6. **Implement instrumentation**
   - Prefer public trace and metrics sinks.
   - Add missing spans/events at the source when the study cannot infer them reliably.
   - Keep study-owned metrics in the study report schema.

## Output

Return:
- study question;
- metrics table;
- decision rule;
- implementation checklist;
- documentation path.
