---
'ironqr': patch
---

Two defensive scan-pipeline improvements that don't shift the current
corpus rate but harden the decoder against future inputs:

- **Per-channel grayscale fallback** (`toChannelGray`). After Otsu and
  Sauvola fail on luma, the scanner now retries the R, then B channels
  individually. BT.601 luma weights blue at 11% and red at 30%, so
  saturated blue/red QRs collapse toward white in the luma channel and
  Otsu can't split them; the underlying channel still has the QR's
  full dynamic range.

- **Timing-row pre-flight** in scan-frame. Before each expensive
  `decodeGridLogical` attempt, the sampled grid's row-6 timing pattern
  is checked for the expected dark/light alternation between the top
  finders; triples whose grid fails this cheap check are skipped
  before the decoder runs. Lets the scanner iterate more candidate
  triples (now 8 per binary, up from 5) without proportional cost.
