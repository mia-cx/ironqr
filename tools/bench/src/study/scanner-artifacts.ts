import crypto from 'node:crypto';
import type { ImageDataLike } from '../../../../packages/ironqr/src/contracts/scan.js';
import {
  clusterRankedProposals,
  type ProposalCluster,
} from '../../../../packages/ironqr/src/pipeline/clusters.js';
import {
  createNormalizedImage,
  type NormalizedImage,
} from '../../../../packages/ironqr/src/pipeline/frame.js';
import {
  buildGridResolutionFromHomography,
  type GeometryCandidate,
} from '../../../../packages/ironqr/src/pipeline/geometry.js';
import {
  detectFinderEvidenceWithSummary,
  type FinderEvidenceDetection,
  type FinderEvidenceDetectionPolicy,
  generateProposalBatchFromFinderEvidence,
  type ProposalAssemblyVariant,
  type ProposalBatchFromEvidenceOptions,
  type ProposalGeometryVariant,
  type ProposalRankingVariant,
  type ProposalViewBatch,
  type RankedProposalCandidate,
  rankProposalCandidates,
  type ScanProposal,
} from '../../../../packages/ironqr/src/pipeline/proposals.js';
import {
  type BinaryPlane,
  type BinaryView,
  type BinaryViewId,
  buildBinaryViews,
  buildScalarViews,
  createViewBank,
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

export interface ProposalFrontierArtifactOptions {
  readonly viewIds: readonly BinaryViewId[];
  readonly maxProposalsPerView?: number;
  readonly detectorPolicy?: FinderEvidenceDetectionPolicy;
  readonly assemblyVariant?: ProposalAssemblyVariant;
  readonly geometryVariant?: ProposalGeometryVariant;
  readonly rankingVariant?: ProposalRankingVariant;
}

export interface ClusterFrontierArtifactOptions extends ProposalFrontierArtifactOptions {
  readonly maxProposals: number;
  readonly maxClusterRepresentatives: number;
  readonly representativeVariant?: import('../../../../packages/ironqr/src/pipeline/clusters.js').ClusterRepresentativeVariant;
}

interface ProposalBatchesArtifact {
  readonly batches: readonly ProposalViewBatch[];
}

interface RankedFrontierArtifact {
  readonly candidates: readonly SerializedRankedProposalCandidate[];
}

interface SerializedRankedProposalCandidate {
  readonly proposal: ScanProposal;
  readonly initialGeometryCandidates: readonly SerializedGeometryCandidate[];
}

interface SerializedGeometryCandidate {
  readonly version: number;
  readonly size: number;
  readonly homography: GeometryCandidate['homography'];
  readonly id: string;
  readonly proposalId: string;
  readonly binaryViewId: BinaryViewId;
  readonly geometryMode: GeometryCandidate['geometryMode'];
  readonly geometryScore: number;
}

interface ClusterFrontierArtifact {
  readonly clusters: readonly ProposalCluster[];
}

export interface ProposalFrontierArtifacts extends ScannerViewArtifacts {
  readonly proposalBatchesKey: string;
  readonly rankedFrontierKey: string;
  readonly batches: readonly ProposalViewBatch[];
  readonly rankedCandidates: readonly RankedProposalCandidate[];
}

export interface ClusterFrontierArtifacts extends ProposalFrontierArtifacts {
  readonly clusterFrontierKey: string;
  readonly clusters: readonly ProposalCluster[];
}

export const getOrComputeProposalFrontierArtifacts = async (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
  options: ProposalFrontierArtifactOptions,
): Promise<ProposalFrontierArtifacts> => {
  const viewArtifacts = await getOrComputeScannerViewArtifacts(asset, artifactCache);
  const viewBank = createViewBank(viewArtifacts.image);
  const { batches, proposalBatchesKey } = await getOrComputeProposalBatches(
    asset,
    artifactCache,
    viewArtifacts.binaryViewsKey,
    viewBank,
    options,
  );
  const { rankedCandidates, rankedFrontierKey } = await getOrComputeRankedFrontier(
    asset,
    artifactCache,
    proposalBatchesKey,
    viewBank,
    batches,
    options,
  );
  return { ...viewArtifacts, proposalBatchesKey, rankedFrontierKey, batches, rankedCandidates };
};

export const getOrComputeClusterFrontierArtifacts = async (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
  options: ClusterFrontierArtifactOptions,
): Promise<ClusterFrontierArtifacts> => {
  const proposalFrontier = await getOrComputeProposalFrontierArtifacts(
    asset,
    artifactCache,
    options,
  );
  const input = {
    layer: 'clusterFrontier' as const,
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: proposalFrontier.rankedFrontierKey,
    config: {
      maxProposals: options.maxProposals,
      maxClusterRepresentatives: options.maxClusterRepresentatives,
      representativeVariant: options.representativeVariant ?? 'proposal-score',
    },
  };
  const clusterFrontierKey = artifactCache.key(input);
  const cached = await artifactCache.readJson<ClusterFrontierArtifact>(input);
  if (cached !== null)
    return { ...proposalFrontier, clusterFrontierKey, clusters: cached.clusters };
  const allClusters = clusterRankedProposals(
    proposalFrontier.rankedCandidates.map((candidate) => candidate.proposal),
    {
      maxRepresentatives: options.maxClusterRepresentatives,
      ...(options.representativeVariant === undefined
        ? {}
        : { representativeVariant: options.representativeVariant }),
    },
  );
  const clusters = allClusters.slice(0, options.maxProposals);
  await artifactCache.writeJson(input, { clusters } satisfies ClusterFrontierArtifact);
  return { ...proposalFrontier, clusterFrontierKey, clusters };
};

const getOrComputeProposalBatches = async (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
  binaryViewsKey: string,
  viewBank: ReturnType<typeof createViewBank>,
  options: ProposalFrontierArtifactOptions,
): Promise<{
  readonly batches: readonly ProposalViewBatch[];
  readonly proposalBatchesKey: string;
}> => {
  const finderKeys = options.viewIds.map((binaryViewId) =>
    finderEvidenceArtifactKey(
      asset,
      artifactCache,
      binaryViewsKey,
      binaryViewId,
      options.detectorPolicy,
    ),
  );
  const input = {
    layer: 'proposalBatches' as const,
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: stableHash(finderKeys),
    config: proposalBatchConfig(options),
  };
  const proposalBatchesKey = artifactCache.key(input);
  const cached = await artifactCache.readJson<ProposalBatchesArtifact>(input);
  if (cached !== null) return { batches: cached.batches, proposalBatchesKey };

  const batches: ProposalViewBatch[] = [];
  for (const binaryViewId of options.viewIds) {
    const binaryView = viewBank.getBinaryView(binaryViewId);
    const detection = await getOrComputeFinderEvidence(
      asset,
      artifactCache,
      binaryViewsKey,
      binaryView,
      options.detectorPolicy,
    );
    batches.push(
      generateProposalBatchFromFinderEvidence(binaryView, detection, proposalBatchOptions(options)),
    );
  }
  await artifactCache.writeJson(input, { batches } satisfies ProposalBatchesArtifact);
  return { batches, proposalBatchesKey };
};

const getOrComputeFinderEvidence = async (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
  binaryViewsKey: string,
  binaryView: BinaryView,
  detectorPolicy: FinderEvidenceDetectionPolicy | undefined,
): Promise<FinderEvidenceDetection> => {
  const input = {
    layer: 'finderEvidence' as const,
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: binaryViewsKey,
    config: { binaryViewId: binaryView.id, detectorPolicy: detectorPolicy ?? null },
  };
  const cached = await artifactCache.readJson<FinderEvidenceDetection>(input);
  if (cached !== null) return cached;
  const detection = detectFinderEvidenceWithSummary(binaryView, detectorPolicy);
  await artifactCache.writeJson(input, detection);
  return detection;
};

const finderEvidenceArtifactKey = (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
  binaryViewsKey: string,
  binaryViewId: BinaryViewId,
  detectorPolicy: FinderEvidenceDetectionPolicy | undefined,
): string =>
  artifactCache.key({
    layer: 'finderEvidence',
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: binaryViewsKey,
    config: { binaryViewId, detectorPolicy: detectorPolicy ?? null },
  });

const getOrComputeRankedFrontier = async (
  asset: CorpusBenchAsset,
  artifactCache: ScannerArtifactCacheHandle,
  proposalBatchesKey: string,
  viewBank: ReturnType<typeof createViewBank>,
  batches: readonly ProposalViewBatch[],
  options: ProposalFrontierArtifactOptions,
): Promise<{
  readonly rankedCandidates: readonly RankedProposalCandidate[];
  readonly rankedFrontierKey: string;
}> => {
  const input = {
    layer: 'rankedFrontier' as const,
    assetId: asset.id,
    assetSha256: asset.sha256,
    upstreamKey: proposalBatchesKey,
    config: { rankingVariant: options.rankingVariant ?? 'timing-heavy' },
  };
  const rankedFrontierKey = artifactCache.key(input);
  const cached = await artifactCache.readJson<RankedFrontierArtifact>(input);
  if (cached !== null) {
    return {
      rankedFrontierKey,
      rankedCandidates: cached.candidates.map(deserializeRankedProposalCandidate),
    };
  }
  const rankedCandidates = rankProposalCandidates(
    viewBank,
    batches.flatMap((batch) => batch.proposals),
    {
      ...(options.rankingVariant === undefined ? {} : { rankingVariant: options.rankingVariant }),
    },
  );
  await artifactCache.writeJson(input, {
    candidates: rankedCandidates.map(serializeRankedProposalCandidate),
  } satisfies RankedFrontierArtifact);
  return { rankedFrontierKey, rankedCandidates };
};

const serializeRankedProposalCandidate = (
  candidate: RankedProposalCandidate,
): SerializedRankedProposalCandidate => ({
  proposal: candidate.proposal,
  initialGeometryCandidates: candidate.initialGeometryCandidates.map((geometry) => ({
    version: geometry.version,
    size: geometry.size,
    homography: geometry.homography,
    id: geometry.id,
    proposalId: geometry.proposalId,
    binaryViewId: geometry.binaryViewId,
    geometryMode: geometry.geometryMode,
    geometryScore: geometry.geometryScore,
  })),
});

const deserializeRankedProposalCandidate = (
  candidate: SerializedRankedProposalCandidate,
): RankedProposalCandidate => ({
  proposal: candidate.proposal,
  initialGeometryCandidates: candidate.initialGeometryCandidates.flatMap((geometry) => {
    const hydrated = buildGridResolutionFromHomography(
      geometry.version,
      geometry.size,
      geometry.homography,
      geometry.id,
      geometry.proposalId,
      geometry.binaryViewId,
      geometry.geometryMode,
      geometry.geometryScore,
    );
    return hydrated === null ? [] : [hydrated];
  }),
});

const proposalBatchOptions = (
  options: ProposalFrontierArtifactOptions,
): ProposalBatchFromEvidenceOptions => ({
  ...(options.maxProposalsPerView === undefined
    ? {}
    : { maxProposalsPerView: options.maxProposalsPerView }),
  ...(options.assemblyVariant === undefined ? {} : { assemblyVariant: options.assemblyVariant }),
  ...(options.geometryVariant === undefined ? {} : { geometryVariant: options.geometryVariant }),
});

const proposalBatchConfig = (
  options: ProposalFrontierArtifactOptions,
): Record<string, unknown> => ({
  viewIds: options.viewIds,
  maxProposalsPerView: options.maxProposalsPerView ?? null,
  detectorPolicy: options.detectorPolicy ?? null,
  assemblyVariant: options.assemblyVariant ?? null,
  geometryVariant: options.geometryVariant ?? null,
});

const stableHash = (value: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
