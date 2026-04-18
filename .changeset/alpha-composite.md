---
'ironqr': patch
---

`toGrayscale` now composites pixels with alpha < 255 onto a white background
before computing luma, matching browser and image-viewer behaviour for
transparent PNGs and WebPs. Fully transparent pixels read as white (the
colour the user actually sees), not black — so QR codes encoded in the
alpha channel of an otherwise-empty image now decode correctly.
