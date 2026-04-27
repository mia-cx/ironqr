import type { ImageDataLike } from '../../../../packages/ironqr/src/contracts/scan.js';
import {
  createNormalizedImage,
  type NormalizedImage,
} from '../../../../packages/ironqr/src/pipeline/frame.js';
import {
  type BinaryPlane,
  type BinaryView,
  type BinaryViewId,
  buildBinaryViews,
  buildScalarViews,
  type ScalarView,
  type ScalarViewId,
  type ThresholdMethod,
} from '../../../../packages/ironqr/src/pipeline/views.js';
import type { CorpusBenchAsset } from '../accuracy/types.js';
import type { ScannerArtifactCacheHandle } from './scanner-artifact-cache.js';

interface NormalizedFrameArtifact {
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

interface ScalarViewsArtifact {
  readonly views: readonly SerializedScalarView[];
}

interface SerializedScalarView {
  readonly id: ScalarViewId;
  readonly width: number;
  readonly height: number;
  readonly family: ScalarView['family'];
  readonly values: readonly number[];
}

interface BinaryViewsArtifact {
  readonly planes: readonly SerializedBinaryPlane[];
  readonly views: readonly SerializedBinaryView[];
}

interface SerializedBinaryPlane {
  readonly scalarViewId: ScalarViewId;
  readonly threshold: ThresholdMethod;
  readonly width: number;
  readonly height: number;
  readonly data: readonly number[];
}

interface SerializedBinaryView {
  readonly id: BinaryViewId;
  readonly scalarViewId: ScalarViewId;
  readonly threshold: ThresholdMethod;
  readonly polarity: BinaryView['polarity'];
  readonly width: number;
  readonly height: number;
}

export interface ScannerViewArtifacts {
  readonly image: NormalizedImage;
  readonly normalizedFrameKey: string;
  readonly scalarViewsKey: string;
  readonly binaryViewsKey: string;
}

export const getOrComputeScannerViewArtifacts = async (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
): Promise<ScannerViewArtifacts> => {
  const image = await getOrComputeNormalizedFrame(asset, artifactCache);
  const normalizedFrameKey = normalizedFrameArtifactKey(asset, artifactCache);
  await getOrComputeScalarViews(asset, image, normalizedFrameKey, artifactCache);
  const scalarViewsKey = scalarViewsArtifactKey(asset, normalizedFrameKey, artifactCache);
  await getOrComputeBinaryViews(asset, image, scalarViewsKey, artifactCache);
  const binaryViewsKey = binaryViewsArtifactKey(asset, scalarViewsKey, artifactCache);
  return { image, normalizedFrameKey, scalarViewsKey, binaryViewsKey };
};

export const normalizedFrameArtifactKey = (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
): string =>
  artifactCache.key({
    layer: 'normalizedFrame',
    assetId: asset.id,
    assetSha256: asset.sha256,
  });

export const scalarViewsArtifactKey = (
  asset: CorpusBenchAsset,
  normalizedFrameKey: string,
  artifactCache: ScannerArtifactCacheHandle,
): string =>
  artifactCache.key({
    layer: 'scalarViews',
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: normalizedFrameKey,
    config: { viewSet: 'default-all' },
  });

export const binaryViewsArtifactKey = (
  asset: CorpusBenchAsset,
  scalarViewsKey: string,
  artifactCache: ScannerArtifactCacheHandle,
): string =>
  artifactCache.key({
    layer: 'binaryViews',
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: scalarViewsKey,
    config: { viewSet: 'default-all' },
  });

const getOrComputeNormalizedFrame = async (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
): Promise<NormalizedImage> => {
  const input = {
    layer: 'normalizedFrame' as const,
    assetId: asset.id,
    assetSha256: asset.sha256,
  };
  const metadata = await artifactCache.readJson<NormalizedFrameArtifact>(input);
  const bytes = metadata === null ? null : await artifactCache.readBinary(input);
  if (metadata !== null && bytes !== null) {
    return createNormalizedImage({
      width: metadata.width,
      height: metadata.height,
      data: new Uint8ClampedArray(bytes),
    });
  }

  const loaded = (await asset.loadImage()) as ImageDataLike;
  const normalized = createNormalizedImage(loaded);
  await artifactCache.writeJson(input, {
    width: normalized.width,
    height: normalized.height,
    byteLength: normalized.rgbaPixels.byteLength,
  } satisfies NormalizedFrameArtifact);
  await artifactCache.writeBinary(input, new Uint8Array(normalized.rgbaPixels));
  return normalized;
};

const getOrComputeScalarViews = async (
  asset: CorpusBenchAsset,
  image: NormalizedImage,
  normalizedFrameKey: string,
  artifactCache: ScannerArtifactCacheHandle,
): Promise<void> => {
  const input = {
    layer: 'scalarViews' as const,
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: normalizedFrameKey,
    config: { viewSet: 'default-all' },
  };
  const cached = await artifactCache.readJson<ScalarViewsArtifact>(input);
  if (cached !== null) {
    hydrateScalarViews(image, cached.views);
    return;
  }
  const views = buildScalarViews(image);
  await artifactCache.writeJson(input, { views: views.map(serializeScalarView) });
};

const getOrComputeBinaryViews = async (
  asset: CorpusBenchAsset,
  image: NormalizedImage,
  scalarViewsKey: string,
  artifactCache: ScannerArtifactCacheHandle,
): Promise<void> => {
  const input = {
    layer: 'binaryViews' as const,
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: scalarViewsKey,
    config: { viewSet: 'default-all' },
  };
  const cached = await artifactCache.readJson<BinaryViewsArtifact>(input);
  if (cached !== null) {
    hydrateBinaryViews(image, cached);
    return;
  }
  const views = buildBinaryViews(image);
  const planes = uniquePlanes(views);
  await artifactCache.writeJson(input, {
    planes: planes.map(serializeBinaryPlane),
    views: views.map(serializeBinaryView),
  });
};

const serializeScalarView = (view: ScalarView): SerializedScalarView => ({
  id: view.id,
  width: view.width,
  height: view.height,
  family: view.family,
  values: [...view.values],
});

const hydrateScalarViews = (
  image: NormalizedImage,
  views: readonly SerializedScalarView[],
): void => {
  for (const view of views) {
    image.derivedViews.scalarViews.set(view.id, {
      id: view.id,
      width: view.width,
      height: view.height,
      family: view.family,
      values: Uint8Array.from(view.values),
    } satisfies ScalarView);
  }
};

const uniquePlanes = (views: readonly BinaryView[]): readonly BinaryPlane[] => {
  const planes = new Map<string, BinaryPlane>();
  for (const view of views) planes.set(`${view.scalarViewId}:${view.threshold}`, view.plane);
  return [...planes.values()];
};

const serializeBinaryPlane = (plane: BinaryPlane): SerializedBinaryPlane => ({
  scalarViewId: plane.scalarViewId,
  threshold: plane.threshold,
  width: plane.width,
  height: plane.height,
  data: [...plane.data],
});

const serializeBinaryView = (view: BinaryView): SerializedBinaryView => ({
  id: view.id,
  scalarViewId: view.scalarViewId,
  threshold: view.threshold,
  polarity: view.polarity,
  width: view.width,
  height: view.height,
});

const hydrateBinaryViews = (image: NormalizedImage, artifact: BinaryViewsArtifact): void => {
  const planes = new Map<string, BinaryPlane>();
  for (const plane of artifact.planes) {
    const hydrated = {
      scalarViewId: plane.scalarViewId,
      threshold: plane.threshold,
      width: plane.width,
      height: plane.height,
      data: Uint8Array.from(plane.data),
    } satisfies BinaryPlane;
    const key = `${plane.scalarViewId}:${plane.threshold}`;
    planes.set(key, hydrated);
    image.derivedViews.binaryPlanes.set(key, hydrated);
  }
  for (const view of artifact.views) {
    const plane = planes.get(`${view.scalarViewId}:${view.threshold}`);
    if (plane === undefined) continue;
    image.derivedViews.binaryViews.set(view.id, {
      id: view.id,
      scalarViewId: view.scalarViewId,
      threshold: view.threshold,
      polarity: view.polarity,
      width: view.width,
      height: view.height,
      plane,
      binary: plane.data,
    } satisfies BinaryView);
  }
};
