# 00 — Media Decode

Media decode turns an external image/video source into a decoded RGBA frame.

This stage is intentionally separate from image normalization. Media decoding is runtime- and format-specific; normalization is the platform-independent contract for pixels after decoding.

This stage defines:

```text
What source formats can IronQR accept?
How are compressed/browser/native media sources decoded into pixels?
Which frame is selected for video or animated media?
What orientation/color-profile/runtime behavior is part of decode?
```

## Responsibility

Stage 00 owns:

```text
external source format handling
compressed source byte limits
browser/runtime image decode behavior
video frame extraction policy
animated image frame policy
EXIF/orientation policy
color-profile/rasterization policy
decode errors before pixel normalization
```

Stage 00 does **not** own:

```text
RGBA buffer length validation
canonical coordinate convention
safe RGBA pixel reads
scalar/binary derived views
QR-specific detection
```

Those begin in later stages.

## Current pipeline input

Current public browser-style scan input accepts sources shaped by `BrowserImageSource`, including:

```text
ImageData-like pixel buffers
ImageBitmap-like sources
Blob/File-like compressed sources
Canvas-like sources
VideoFrame-like sources
```

The exact browser/runtime support depends on:

```text
createImageBitmap
OffscreenCanvas
2D canvas getImageData
```

## Current decode path

If the input is already `ImageData`-like, decoding is skipped:

```text
ImageData-like input
→ stage 01 normalization
```

If the input is a compressed/browser source, the current browser path is:

```text
input
→ preflight source validation
→ createImageBitmap(input) when needed
→ draw bitmap to OffscreenCanvas
→ getImageData(0, 0, width, height)
→ stage 01 normalization
```

This means the browser/runtime currently owns much of the media interpretation:

```text
JPEG/PNG/WebP decode
browser-supported formats
EXIF orientation behavior
color profile conversion/rasterization
image smoothing/raster details from drawImage/getImageData
```

## Current decoded-frame output

The current handoff to stage 01 is equivalent to an `ImageData`-like frame:

```ts
interface DecodedImageFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray; // row-major RGBA
}
```

Target richer form:

```ts
interface DecodedImageFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly mediaMetadata?: {
    readonly sourceKind: 'image-data' | 'blob' | 'bitmap' | 'canvas' | 'video-frame' | 'native';
    readonly mimeType?: string;
    readonly frameIndex?: number;
    readonly timestampMs?: number;
    readonly decoder?: string;
  };
}
```

Stage 01 should not care whether these pixels came from JPEG, PNG, WebP, a canvas, or a video frame. It should only validate and adopt the decoded RGBA frame.

## Pre-decode metadata validation

Many source types expose dimensions before or during decode:

| Source kind | Dimension metadata |
| --- | --- |
| `ImageData` | `width`, `height` |
| `ImageBitmap` | `width`, `height` |
| `Canvas` | `width`, `height` |
| `VideoFrame` | `displayWidth` / `displayHeight` or `codedWidth` / `codedHeight` |
| `Blob` / `File` | usually byte size only; dimensions require header parse or decode |
| encoded JPEG/PNG/WebP bytes | dimensions often exist in headers, but current browser path does not parse them itself |

Stage 00 should reject impossible or over-budget dimensions as early as metadata permits.

Current browser preflight already validates dimensions for canvas-like and video-frame-like inputs before bitmap conversion. Blob-like compressed sources currently only get byte-size preflight because dimensions are not known without parsing or decoding.

Policy:

```text
if dimensions are available before decode, validate them in stage 00
always validate the decoded frame again in stage 01
```

Why validate twice?

- Metadata can be absent.
- Metadata can be wrong or malicious.
- Decode can apply orientation/transforms that change displayed dimensions.
- Different runtimes may expose coded vs display dimensions differently.
- Stage 01 is the final trust boundary for actual allocated RGBA pixels.

## Source size limits

The current compressed browser source preflight limit is tied to the image-area budget:

```ts
MAX_IMAGE_SOURCE_BYTES = MAX_IMAGE_PIXELS * 4;
```

This is a safety cap before bitmap decode. It is not the same as decoded pixel memory.

Target spec note:

```text
compressed-source byte limits are stage 00 policy
metadata dimension preflight is stage 00 policy when dimensions are available
decoded width/height/area validation is stage 01 policy and always runs
```

These may need separate product budgets later. A compressed JPEG can be small but decode to a huge frame.

## Format support policy

Current browser format support is whatever the runtime can decode through `createImageBitmap` / canvas.

Target policy should become explicit:

| Source kind | Target behavior |
| --- | --- |
| `ImageData` | Accept directly as decoded RGBA. |
| PNG | Decode first frame to RGBA. |
| JPEG | Decode to RGBA, document orientation/color behavior. |
| WebP | Decode still image or selected frame. |
| GIF/APNG/animated WebP | Define first-frame vs requested-frame policy before claiming support. |
| BMP | Supported only if runtime/native decoder supports it. |
| VideoFrame | Decode/copy the provided frame, preserving timestamp metadata if available. |
| Canvas/ImageBitmap | Draw/read RGBA through runtime. |

Do not imply deterministic cross-runtime support until tests cover it.

## Video and animation policy

Video and animated images are not the same as a still image.

The spec should eventually define:

```text
single VideoFrame scan = decode exactly that frame
stream scan = caller/session provides frames over time
animated image scan = first frame by default, or explicit frame selection
```

Temporal tracking belongs to a future scanner-session stage, not stage 00.

## Color and orientation policy

This is currently browser-defined. For cross-runtime conformance, we eventually need explicit answers:

```text
Are EXIF orientation tags honored before normalization?
Are embedded color profiles converted to sRGB?
Are transparent pixels preserved as alpha for stage 01?
```

Current practical stance:

```text
stage 00 accepts the runtime-decoded RGBA pixels as provided
stage 01 preserves those RGBA bytes as the canonical frame
stage 02 composites alpha on white when deriving scalar views
```

## Errors

Stage 00 errors are about failing to obtain decoded pixels:

```text
unsupported source kind
source byte limit exceeded
missing createImageBitmap / OffscreenCanvas support
decode failure
canvas/context failure
```

Stage 01 errors are about invalid decoded frames:

```text
bad dimensions
bad buffer type
bad buffer length
decoded area too large
```

## Validation metrics

| Metric | Purpose |
| --- | --- |
| Which source formats are used in real integrations? | Prioritize decoder/conformance work. |
| Do browser and Node/native decoders produce identical RGBA for corpus fixtures? | Required for future Rust/WASM conformance. |
| Do EXIF/color-profile differences affect QR outcomes? | Prevent platform-specific scan behavior. |
| What is a safe compressed-source byte cap independent of decoded pixel cap? | Avoid zip-bomb-like inputs. |
| How should video-frame scanning budget work? | Real-time scanner design. |

## Cache boundary

Stage 00 is not currently a persisted scanner artifact layer. The persisted L1 artifact starts after decode, at the normalized RGBA frame.

If future decoder comparisons need persisted artifacts, add a separate pre-L1 cache identity:

```text
L0 decoded media frame
```

Bump L0 when media decode policy changes, such as orientation handling, color profile conversion, animated-frame selection, or decoder backend.
