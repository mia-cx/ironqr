# Runtime State Boundary

Derived scalar/binary/OKLab views are runtime memoization owned outside L1 image data.

Target ownership:

```text
SimpleImageData
  width, height, Uint8ClampedArray RGBA data only

ViewBank / ScanContext
  scalar view cache
  binary plane cache
  binary view cache
  OKLab plane cache
```

`ViewBank` / `ScanContext` owns runtime memoization.
