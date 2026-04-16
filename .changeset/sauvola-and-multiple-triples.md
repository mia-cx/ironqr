---
'ironqr': minor
---

`scanFrame` now tries multiple binarization strategies, multiple finder
triples per binary, and multiple version candidates per triple before
giving up:

- **Sauvola adaptive binarization** as a fallback after Otsu, with two
  window sizes (large for QRs that fill the frame, small for QRs
  embedded in busy scenes). Captures the QR's local foreground/
  background relationship even when the global histogram is dominated
  by other content (textured paper, photo backgrounds).
- **Multiple-triple fall-through**: `detectFinderCandidatePool` now
  exposes the full deduped candidate pool (12 candidates), and the
  scanner tries the top 5 best-scoring L-shape triples per binary
  before moving on. Noisy scenes can produce several QR-shaped Ls;
  only the decoder knows which is real.
- **Version retry**: at v≥7 the finder-distance heuristic is only
  ~85% reliable, so the scanner now tries the estimate plus ±1/±2
  versions per triple. Fixes "could not decode QR version
  information" failures where the grid size was off by one.

Net real-world corpus impact: 16/35 → 17/35 (46% → 49%) decode rate.
0/11 false positives.
