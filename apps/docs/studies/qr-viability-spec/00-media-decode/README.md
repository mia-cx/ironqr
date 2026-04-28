# 00 — Media Decode

Media decode turns an external media source into browser `ImageData`.

This stage is intentionally separate from image normalization:

```text
00 media decode
  external source → ImageData

01 image normalization
  ImageData → SimpleImageData with Uint8ClampedArray RGBA
```

Stage 00 is runtime- and format-specific. Stage 01 is IronQR's platform-independent pixel contract.

## Responsibility

Stage 00 owns:

```text
external source format handling
decoder/backend selection
compressed source byte limits
pre-decode metadata validation when dimensions are available
browser/runtime/native media decode behavior
video frame extraction policy
animated image frame policy
EXIF/orientation policy
color-profile/rasterization policy
decode errors before pixel normalization
```

Stage 00 does **not** own:

```text
canonical 8-bit RGBA conversion
final decoded-frame width/height/area validation
final buffer type and length validation
canonical coordinate convention
safe RGBA pixel reads
scalar/binary derived views
QR-specific detection
```

Those begin in stage 01 or later.

## Input

Stage 00 accepts external media sources, including browser-shaped sources and future native/WASM sources.

Current public browser-style scan input includes:

```text
ImageData pixel buffers
ImageBitmap-like sources
Blob/File-like compressed sources
Canvas-like sources
VideoFrame-like sources
```

Target source support:

```text
all common still-image formats supported by the active browser/runtime
plus explicit HEIC/HEIF support for iPhone uploads via native or supplemental decoder fallback
```

Do not interpret “all image formats” literally. The product target is broad practical support, with clear unsupported-format errors for obscure, unsafe, encrypted, malformed, multi-page, or unavailable decoder cases.

## Output

Stage 00 outputs browser `ImageData`, not a custom decoded-frame interface and not IronQR's canonical normalized frame.

```ts
type MediaDecodeOutput = ImageData;
```

Do not reinvent this object in the spec. `ImageData` already carries the decoded frame dimensions and pixel buffer:

```text
width
height
data
```

Notes:

- Classic browser `ImageData.data` is `Uint8ClampedArray`.
- Modern HDR / wide-gamut `ImageData` may use a float16 pixel format in runtimes that expose it.
- Stage 00 may keep decode metadata outside the `ImageData` object when needed, but the stage handoff remains `ImageData`.
- Stage 01 must convert or reject anything that is not canonical `Uint8ClampedArray` RGBA.

Optional sidecar metadata, when useful, is separate from the stage output:

```ts
interface MediaDecodeMetadata {
  readonly sourceKind: 'image-data' | 'blob' | 'bitmap' | 'canvas' | 'video-frame' | 'native';
  readonly mimeType?: string;
  readonly fileExtension?: string;
  readonly frameIndex?: number;
  readonly timestampMs?: number;
  readonly decoder?: string;
}
```

Stage 01 should not care whether pixels came from JPEG, PNG, WebP, HEIC, a canvas, or a video frame. It should only normalize `ImageData` into `SimpleImageData`.

## Current browser decode path

If the input is already `ImageData`, decoding is skipped:

```text
ImageData input
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

## Format support policy

Format support is tiered.

### Tier 1: runtime-native decode

Use the active runtime decoder first:

```text
browser createImageBitmap / canvas / ImageDecoder when available
native decoder backend when available
future Rust/WASM decode backend when available
```

Common runtime-supported formats may include:

```text
PNG
JPEG
WebP
GIF
BMP
AVIF
SVG image sources where safe and explicitly allowed
```

Actual support depends on runtime.

### Tier 2: explicit supplemental decoders

Some important user formats are not reliably browser-supported everywhere.

Explicit target:

```text
HEIC / HEIF for iPhone uploads
```

The decoder policy should be:

```text
try runtime-native decode if supported
else detect HEIC/HEIF and use supplemental decoder
else reject with actionable unsupported-format error
```

Supplemental decoder may be:

```text
browser WASM decoder
Node/native decoder
future Rust-backed decoder
```

### Tier 3: actionable rejection

Unsupported formats should fail with an error that tells the user what to do:

```text
unsupported_image_format
convert to PNG/JPEG/WebP or enable HEIC/HEIF support
```

## Format detection

Do not rely only on one signal.

Use layered detection:

```text
declared MIME type
file extension
magic bytes / file signature
runtime decode probe
```

HEIC/HEIF are ISO BMFF-family files. Detection often uses the `ftyp` box and brands such as:

```text
heic
heix
hevc
hevx
mif1
msf1
```

## Pre-decode metadata validation

Many source types expose dimensions before or during decode:

| Source kind | Dimension metadata |
| --- | --- |
| `ImageData` | `width`, `height` |
| `ImageBitmap` | `width`, `height` |
| `Canvas` | `width`, `height` |
| `VideoFrame` | `displayWidth` / `displayHeight` or `codedWidth` / `codedHeight` |
| `Blob` / `File` | byte size; dimensions require header parse or decode |
| encoded PNG/JPEG/WebP/HEIC bytes | dimensions often exist in headers/boxes, but current browser path does not parse all of them itself |

Stage 00 must reject impossible or over-budget dimensions as early as metadata permits.

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
- Stage 01 is the final trust boundary for actual decoded pixels.

## Source size limits

Compressed source byte limits are stage 00 policy.

Current browser preflight ties source byte cap to the decoded area budget:

```ts
MAX_IMAGE_SOURCE_BYTES = MAX_IMAGE_PIXELS * 4;
```

That is a safety cap before bitmap decode. It is not the same as decoded pixel memory.

Target policy:

```text
compressed-source byte limits are stage 00 policy
metadata dimension preflight is stage 00 policy when dimensions are available
decoded width/height/area validation is stage 01 policy and always runs
```

A compressed JPEG or HEIC can be small but decode to a huge frame, so byte-size validation is not enough.

## Video and animation policy

Video and animated images are not the same as still images.

Target behavior:

```text
single VideoFrame scan = decode exactly that frame
stream scan = caller/session provides frames over time
animated image scan = first frame by default unless explicit frame selection exists
```

Temporal tracking belongs to a future scanner-session design, not stage 00.

## Color, HDR, and orientation policy

Stage 00 may produce runtime-specific `ImageData`:

```text
8-bit sRGB-like RGBA
Display-P3 data
float16 HDR data
runtime-oriented pixels
non-oriented pixels, depending on decoder
```

Stage 00 must record decode metadata when the runtime exposes it.

Stage 01 owns conversion to IronQR's canonical 8-bit RGBA `SimpleImageData`.

Until a full HDR policy exists:

```text
Float16 / HDR ImageData is allowed as a stage-00 decoded frame shape
but stage 01 must explicitly convert it with documented policy or reject it
```

Do not silently treat `Float16Array` as if it were 8-bit RGBA.

## Errors

Stage 00 errors are about failing to obtain a decoded frame:

```text
unsupported source kind
unsupported image format
source byte limit exceeded
metadata dimensions over budget
missing browser decode APIs
decode failure
canvas/context failure
supplemental decoder failure
```

Stage 01 errors are about failing to normalize the decoded frame:

```text
bad decoded dimensions
decoded area too large
unsupported decoded pixel format
bad buffer type
bad buffer length
unsupported color/HDR conversion policy
```

## Validation metrics

| Metric | Purpose |
| --- | --- |
| Format coverage by runtime | Verify browser/native/WASM support promises. |
| HEIC/HEIF iPhone fixture coverage | Ensure iPhone uploads work. |
| Metadata preflight rejection count | Prove oversized inputs fail before expensive decode when possible. |
| Decode-output pixel format distribution | Track `Uint8ClampedArray` vs `Float16Array` / HDR cases. |
| EXIF/orientation fixture outcomes | Prevent platform-specific rotation bugs. |
| Color-profile fixture outcomes | Prevent platform-specific color/threshold behavior. |
| Compressed-byte cap failures | Validate source-size safety policy. |

## Cache boundary

Stage 00 is not currently a persisted scanner artifact layer. The persisted L1 artifact starts after stage 01 normalization.

If future decoder comparisons need persisted artifacts, add a separate pre-L1 cache identity:

```text
L0 decoded media frame
```

Bump L0 when media decode policy changes, such as orientation handling, color profile conversion, animated-frame selection, HEIC/HEIF decoder selection, or decoder backend.
