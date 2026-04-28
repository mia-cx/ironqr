# Study Cache Note

Runtime scanning owns scalar views through `ViewBank`. It does not persist scalar views across scans.

Benchmark/study tooling may persist this stage as:

```text
L2 scalar views
```

Bump the study L2 cache version when:

- scalar view list changes,
- formulas change,
- alpha-composite policy changes in a way that affects scalar values,
- OKLab byte center, chroma gain, or axis encoding changes.
