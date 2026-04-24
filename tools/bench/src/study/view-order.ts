import { createTraceCollector, scanFrame } from '../../../../packages/ironqr/src/index.js';
import type {
  IronqrTraceEvent,
  ProposalViewGeneratedEvent,
} from '../../../../packages/ironqr/src/pipeline/trace.js';
import { describeAccuracyEngine, getAccuracyEngineById } from '../core/engines.js';
import { normalizeDecodedText } from '../shared/text.js';
import type { StudyPlugin, StudySummaryInput } from './types.js';

interface ViewProposalsConfig extends Record<string, unknown> {
  readonly preset: 'production';
  readonly engineId: 'ironqr';
  readonly traceMode: 'full';
  readonly topK: number;
}

interface ViewProposalAssetResult {
  readonly assetId: string;
  readonly label: 'qr-pos' | 'qr-neg';
  readonly expectedTexts: readonly string[];
  readonly decodedTexts: readonly string[];
  readonly matchedTexts: readonly string[];
  readonly falsePositiveTexts: readonly string[];
  readonly scanDurationMs: number;
  readonly success: boolean;
  readonly viewRows: readonly ViewProposalAssetRow[];
  readonly scan: {
    readonly proposalCount: number;
    readonly boundedProposalCount: number;
    readonly clusterCount: number;
    readonly processedRepresentativeCount: number;
  } | null;
}

interface ViewProposalAssetRow {
  readonly binaryViewId: string;
  readonly rowScanFinderCount: number;
  readonly floodFinderCount: number;
  readonly matcherFinderCount: number;
  readonly dedupedFinderCount: number;
  readonly expensiveDetectorsRan: boolean;
  readonly tripleCount: number;
  readonly proposalCount: number;
  readonly durationMs: number;
  readonly detectorDurationMs: number;
  readonly tripleAssemblyDurationMs: number;
  readonly proposalConstructionDurationMs: number;
  readonly structurePassCount: number;
  readonly structureFailCount: number;
  readonly decodeAttemptCount: number;
  readonly successCount: number;
  readonly uniqueSuccessCount: number;
  readonly falsePositiveCount: number;
}

interface ViewProposalSummary extends Record<string, unknown> {
  readonly assetCount: number;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly decodedAssetCount: number;
  readonly falsePositiveAssetCount: number;
  readonly cache: StudySummaryInput<ViewProposalsConfig, ViewProposalAssetResult>['cache'];
  readonly recommendation: readonly string[];
  readonly topViews: readonly ViewProposalSummaryRow[];
  readonly slowestViews: readonly ViewProposalSummaryRow[];
}

interface ViewProposalSummaryRow {
  readonly binaryViewId: string;
  readonly assetCount: number;
  readonly proposalCount: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number;
  readonly detectorDurationMs: number;
  readonly structurePassCount: number;
  readonly structureFailCount: number;
  readonly decodeAttemptCount: number;
  readonly successCount: number;
  readonly uniqueSuccessCount: number;
  readonly falsePositiveCount: number;
  readonly expensiveDetectorAssetCount: number;
}

const ironqrDescriptor = () => describeAccuracyEngine(getAccuracyEngineById('ironqr'));

const parseConfig = ({
  flags,
}: {
  readonly flags: Readonly<Record<string, string | number | boolean>>;
}): ViewProposalsConfig => {
  const preset = flags.preset ?? 'production';
  if (preset !== 'production')
    throw new Error(`view-proposals only supports --preset production, got ${String(preset)}`);
  const topK = typeof flags['top-k'] === 'number' ? flags['top-k'] : 18;
  if (!Number.isSafeInteger(topK) || topK < 1) {
    throw new Error(
      `view-proposals --top-k must be a positive integer, got ${String(flags['top-k'])}`,
    );
  }
  return { preset, engineId: 'ironqr', traceMode: 'full', topK };
};

export const viewProposalsStudyPlugin: StudyPlugin<
  ViewProposalSummary,
  ViewProposalsConfig,
  ViewProposalAssetResult
> = {
  id: 'view-proposals',
  title: 'IronQR proposal-view study',
  description:
    'Aggregates per-view proposal cost, structure, decode, success, and false-positive evidence from public ironqr trace events.',
  version: 'study-v1',
  flags: [
    {
      name: 'max-assets',
      type: 'number',
      description: 'Limit approved corpus assets processed by the study.',
    },
    {
      name: 'preset',
      type: 'string',
      description: 'Study preset. Currently only production is supported.',
      default: 'production',
    },
    {
      name: 'top-k',
      type: 'number',
      description: 'Number of recommended proposal views to emit.',
      default: 18,
    },
  ],
  parseConfig,
  cacheKey: (config) => JSON.stringify(config),
  engines: () => [ironqrDescriptor()],
  observability: (config) => ({ traceMode: config.traceMode, traceEvents: 'full' }),
  runAsset: async ({ asset, signal }) => {
    if (signal?.aborted) throw signal.reason ?? new Error('Study interrupted.');
    const image = await asset.loadImage();
    const trace = createTraceCollector();
    const startedAt = performance.now();
    const results = await scanFrame(image, {
      allowMultiple: asset.expectedTexts.length > 1,
      traceSink: trace,
    });
    const scanDurationMs = round(performance.now() - startedAt);
    const decodedTexts = uniqueTexts(
      results.map((result) => normalizeDecodedText(result.payload.text)).filter(Boolean),
    );
    const expected = uniqueTexts(asset.expectedTexts.map(normalizeDecodedText).filter(Boolean));
    const matchedTexts = decodedTexts.filter((text) => expected.includes(text));
    const falsePositiveTexts = asset.label === 'qr-neg' ? decodedTexts : [];
    return {
      assetId: asset.id,
      label: asset.label,
      expectedTexts: expected,
      decodedTexts,
      matchedTexts,
      falsePositiveTexts,
      scanDurationMs,
      success: asset.label === 'qr-neg' ? decodedTexts.length === 0 : matchedTexts.length > 0,
      viewRows: buildViewRows(trace.events, expected, asset.label),
      scan: scanSummary(trace.events),
    };
  },
  summarize: (input) => summarizeViewProposalResults(input),
  renderReport: ({ config, results, summary }) => ({
    config,
    sampledAssets: results.map((result) => ({
      assetId: result.assetId,
      label: result.label,
      expectedTextCount: result.expectedTexts.length,
      decodedTexts: result.decodedTexts,
      matchedTexts: result.matchedTexts,
      falsePositiveTexts: result.falsePositiveTexts,
      scanDurationMs: result.scanDurationMs,
      success: result.success,
      scan: result.scan,
    })),
    perView: summary.topViews,
    slowestViews: summary.slowestViews,
    rows: results.flatMap((result) =>
      result.viewRows.map((row) => ({ assetId: result.assetId, label: result.label, ...row })),
    ),
  }),
};

export const viewOrderStudyPlugin: StudyPlugin<
  ViewProposalSummary,
  ViewProposalsConfig,
  ViewProposalAssetResult
> = {
  ...viewProposalsStudyPlugin,
  id: 'view-order',
  title: 'IronQR view-order study',
  description: 'Compatibility alias for the proposal-view study; use view-proposals for new runs.',
};

const buildViewRows = (
  events: readonly IronqrTraceEvent[],
  expectedTexts: readonly string[],
  label: 'qr-pos' | 'qr-neg',
): readonly ViewProposalAssetRow[] => {
  const proposals = new Map<string, string>();
  const rows = new Map<string, MutableViewProposalAssetRow>();
  const successByView = new Map<string, Set<string>>();
  const falsePositiveByView = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'proposal-view-generated') rows.set(event.binaryViewId, rowFromEvent(event));
    if (event.type === 'proposal-generated') proposals.set(event.proposalId, event.binaryViewId);
    if (event.type === 'proposal-structure-assessed') {
      const row = rowForProposal(rows, proposals, event.proposalId);
      if (event.passed) row.structurePassCount += 1;
      else row.structureFailCount += 1;
    }
    if (event.type === 'decode-attempt-started') {
      rowForProposal(rows, proposals, event.proposalId).decodeAttemptCount += 1;
    }
    if (event.type === 'decode-attempt-succeeded') {
      const proposalViewId = proposals.get(event.proposalId);
      if (!proposalViewId) continue;
      const row = ensureRow(rows, proposalViewId);
      row.successCount += 1;
      const text = normalizeDecodedText(event.payloadText);
      if (label === 'qr-neg' && text.length > 0) {
        falsePositiveByView.set(proposalViewId, (falsePositiveByView.get(proposalViewId) ?? 0) + 1);
      }
      if (expectedTexts.includes(text)) {
        let texts = successByView.get(proposalViewId);
        if (!texts) {
          texts = new Set();
          successByView.set(proposalViewId, texts);
        }
        texts.add(text);
      }
    }
  }

  return [...rows.values()].map((row) => ({
    ...row,
    uniqueSuccessCount: successByView.get(row.binaryViewId)?.size ?? 0,
    falsePositiveCount: falsePositiveByView.get(row.binaryViewId) ?? 0,
  }));
};

interface MutableViewProposalAssetRow {
  binaryViewId: string;
  rowScanFinderCount: number;
  floodFinderCount: number;
  matcherFinderCount: number;
  dedupedFinderCount: number;
  expensiveDetectorsRan: boolean;
  tripleCount: number;
  proposalCount: number;
  durationMs: number;
  detectorDurationMs: number;
  tripleAssemblyDurationMs: number;
  proposalConstructionDurationMs: number;
  structurePassCount: number;
  structureFailCount: number;
  decodeAttemptCount: number;
  successCount: number;
  uniqueSuccessCount?: number;
  falsePositiveCount?: number;
}

const rowFromEvent = (event: ProposalViewGeneratedEvent): MutableViewProposalAssetRow => ({
  binaryViewId: event.binaryViewId,
  rowScanFinderCount: event.rowScanFinderCount,
  floodFinderCount: event.floodFinderCount,
  matcherFinderCount: event.matcherFinderCount,
  dedupedFinderCount: event.dedupedFinderCount,
  expensiveDetectorsRan: event.expensiveDetectorsRan,
  tripleCount: event.tripleCount,
  proposalCount: event.proposalCount,
  durationMs: round(event.durationMs),
  detectorDurationMs: round(event.detectorDurationMs),
  tripleAssemblyDurationMs: round(event.tripleAssemblyDurationMs),
  proposalConstructionDurationMs: round(event.proposalConstructionDurationMs),
  structurePassCount: 0,
  structureFailCount: 0,
  decodeAttemptCount: 0,
  successCount: 0,
});

const rowForProposal = (
  rows: Map<string, MutableViewProposalAssetRow>,
  proposals: Map<string, string>,
  proposalId: string,
): MutableViewProposalAssetRow => ensureRow(rows, proposals.get(proposalId) ?? 'unknown');

const ensureRow = (
  rows: Map<string, MutableViewProposalAssetRow>,
  binaryViewId: string,
): MutableViewProposalAssetRow => {
  const existing = rows.get(binaryViewId);
  if (existing) return existing;
  const row: MutableViewProposalAssetRow = {
    binaryViewId,
    rowScanFinderCount: 0,
    floodFinderCount: 0,
    matcherFinderCount: 0,
    dedupedFinderCount: 0,
    expensiveDetectorsRan: false,
    tripleCount: 0,
    proposalCount: 0,
    durationMs: 0,
    detectorDurationMs: 0,
    tripleAssemblyDurationMs: 0,
    proposalConstructionDurationMs: 0,
    structurePassCount: 0,
    structureFailCount: 0,
    decodeAttemptCount: 0,
    successCount: 0,
  };
  rows.set(binaryViewId, row);
  return row;
};

const scanSummary = (events: readonly IronqrTraceEvent[]) => {
  const finished = events.find((event) => event.type === 'scan-finished');
  if (!finished || finished.type !== 'scan-finished') return null;
  return {
    proposalCount: finished.proposalCount,
    boundedProposalCount: finished.boundedProposalCount,
    clusterCount: finished.clusterCount,
    processedRepresentativeCount: finished.processedRepresentativeCount,
  };
};

const summarizeViewProposalResults = ({
  config,
  results,
  cache,
}: StudySummaryInput<ViewProposalsConfig, ViewProposalAssetResult>): ViewProposalSummary => {
  const views = new Map<string, MutableViewProposalSummaryRow>();
  for (const result of results) {
    for (const row of result.viewRows) {
      const aggregate = ensureSummaryRow(views, row.binaryViewId);
      aggregate.assetCount += 1;
      aggregate.proposalCount += row.proposalCount;
      aggregate.totalDurationMs += row.durationMs;
      aggregate.detectorDurationMs += row.detectorDurationMs;
      aggregate.structurePassCount += row.structurePassCount;
      aggregate.structureFailCount += row.structureFailCount;
      aggregate.decodeAttemptCount += row.decodeAttemptCount;
      aggregate.successCount += row.successCount;
      aggregate.uniqueSuccessCount += row.uniqueSuccessCount;
      aggregate.falsePositiveCount += row.falsePositiveCount;
      if (row.expensiveDetectorsRan) aggregate.expensiveDetectorAssetCount += 1;
    }
  }
  const rows = [...views.values()].map(finalizeSummaryRow);
  const recommendation = [...rows]
    .sort((left, right) => viewRankScore(right) - viewRankScore(left))
    .slice(0, config.topK)
    .map((row) => row.binaryViewId);
  return {
    assetCount: results.length,
    positiveCount: results.filter((result) => result.label === 'qr-pos').length,
    negativeCount: results.filter((result) => result.label === 'qr-neg').length,
    decodedAssetCount: results.filter((result) => result.decodedTexts.length > 0).length,
    falsePositiveAssetCount: results.filter((result) => result.falsePositiveTexts.length > 0)
      .length,
    cache,
    recommendation,
    topViews: [...rows].sort((left, right) => viewRankScore(right) - viewRankScore(left)),
    slowestViews: [...rows]
      .sort((left, right) => right.totalDurationMs - left.totalDurationMs)
      .slice(0, 20),
  };
};

interface MutableViewProposalSummaryRow {
  binaryViewId: string;
  assetCount: number;
  proposalCount: number;
  totalDurationMs: number;
  detectorDurationMs: number;
  structurePassCount: number;
  structureFailCount: number;
  decodeAttemptCount: number;
  successCount: number;
  uniqueSuccessCount: number;
  falsePositiveCount: number;
  expensiveDetectorAssetCount: number;
}

const ensureSummaryRow = (
  rows: Map<string, MutableViewProposalSummaryRow>,
  binaryViewId: string,
): MutableViewProposalSummaryRow => {
  const existing = rows.get(binaryViewId);
  if (existing) return existing;
  const row = {
    binaryViewId,
    assetCount: 0,
    proposalCount: 0,
    totalDurationMs: 0,
    detectorDurationMs: 0,
    structurePassCount: 0,
    structureFailCount: 0,
    decodeAttemptCount: 0,
    successCount: 0,
    uniqueSuccessCount: 0,
    falsePositiveCount: 0,
    expensiveDetectorAssetCount: 0,
  };
  rows.set(binaryViewId, row);
  return row;
};

const finalizeSummaryRow = (row: MutableViewProposalSummaryRow): ViewProposalSummaryRow => ({
  ...row,
  totalDurationMs: round(row.totalDurationMs),
  averageDurationMs: row.assetCount === 0 ? 0 : round(row.totalDurationMs / row.assetCount),
  detectorDurationMs: round(row.detectorDurationMs),
});

const viewRankScore = (row: ViewProposalSummaryRow): number =>
  row.uniqueSuccessCount * 1_000_000 +
  row.successCount * 100_000 +
  row.structurePassCount * 1_000 +
  row.proposalCount * 10 -
  row.falsePositiveCount * 10_000 -
  row.totalDurationMs;

const uniqueTexts = (values: readonly string[]): readonly string[] => [...new Set(values)];

const round = (value: number): number => Math.round(value * 100) / 100;
