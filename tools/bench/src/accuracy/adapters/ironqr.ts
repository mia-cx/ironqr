import {
  createTraceCollector,
  createTraceCounter,
  scanFrame,
} from '../../../../../packages/ironqr/src/index.js';
import type {
  ClusterFinishedEvent,
  IronqrTraceEvent,
  ProposalClustersBuiltEvent,
  ScanFinishedEvent,
  TraceCollector,
  TraceCounter,
} from '../../../../../packages/ironqr/src/pipeline/trace.js';
import type {
  AccuracyEngine,
  AccuracyEngineRunOptions,
  AccuracyScanDiagnostics,
  AccuracyScanResult,
  EngineFailureReason,
  IronqrTraceMode,
} from '../types.js';
import {
  createAvailableAvailability,
  createCachePolicy,
  createCapabilities,
  failureResult,
  successResult,
} from './shared.js';

type IronqrTraceSummary = Partial<Record<IronqrTraceEvent['type'], number>>;

type IronqrFailureTrace = readonly IronqrTraceEvent[] | IronqrTraceSummary;

type IronqrTraceSource = TraceCollector | TraceCounter;

/** Infer the deepest first-party failure stage from ironqr trace activity. */
export const classifyIronqrFailure = (trace: IronqrFailureTrace): EngineFailureReason => {
  if (hasTraceEvent(trace, 'decode-attempt-started')) {
    return 'failed_to_decode';
  }
  if (hasTraceEvent(trace, 'geometry-candidate-created')) {
    return 'failed_to_decode';
  }
  if (hasTraceEvent(trace, 'proposal-generated')) {
    return 'failed_to_resolve_geometry';
  }
  return 'failed_to_find_finders';
};

const hasTraceEvent = (trace: IronqrFailureTrace, type: IronqrTraceEvent['type']): boolean => {
  if (Array.isArray(trace)) {
    return trace.some((event) => event.type === type);
  }
  const summary = trace as IronqrTraceSummary;
  return (summary[type] ?? 0) > 0;
};

export const summarizeIronqrTrace = (
  trace: IronqrTraceSource,
  traceMode: IronqrTraceMode,
): AccuracyScanDiagnostics => {
  const counts = Array.isArray((trace as TraceCollector).events)
    ? countTraceEvents((trace as TraceCollector).events)
    : { ...(trace as TraceCounter).counts };
  const clustering =
    'clustering' in trace
      ? trace.clustering
      : ((trace as TraceCollector).events.find(
          (event): event is ProposalClustersBuiltEvent => event.type === 'proposal-clusters-built',
        ) ?? null);
  const scanFinished =
    'scanFinished' in trace
      ? trace.scanFinished
      : ((trace as TraceCollector).events.find(
          (event): event is ScanFinishedEvent => event.type === 'scan-finished',
        ) ?? null);
  const clusterFinishedEvents =
    'clusterOutcomes' in trace
      ? [...trace.clusterOutcomes]
      : (trace as TraceCollector).events.filter(
          (event): event is ClusterFinishedEvent => event.type === 'cluster-finished',
        );

  return {
    kind: 'ironqr-trace',
    traceMode,
    counts,
    clustering,
    scanFinished,
    clusterOutcomes: {
      decoded: clusterFinishedEvents.filter((event) => event.outcome === 'decoded').length,
      duplicate: clusterFinishedEvents.filter((event) => event.outcome === 'duplicate').length,
      killed: clusterFinishedEvents.filter((event) => event.outcome === 'killed').length,
      exhausted: clusterFinishedEvents.filter((event) => event.outcome === 'exhausted').length,
    },
    attemptFailures: {
      timingCheck:
        'attemptFailures' in trace
          ? (trace.attemptFailures['timing-check'] ?? 0)
          : countAttemptFailures(trace, 'timing-check'),
      decodeFailed:
        'attemptFailures' in trace
          ? (trace.attemptFailures.decode_failed ?? 0)
          : countAttemptFailures(trace, 'decode_failed'),
      internalError:
        'attemptFailures' in trace
          ? (trace.attemptFailures.internal_error ?? 0)
          : countAttemptFailures(trace, 'internal_error'),
    },
    ...('events' in trace ? { eventCount: trace.events.length } : {}),
    ...('events' in trace && traceMode === 'full' ? { events: trace.events } : {}),
  };
};

const countTraceEvents = (events: readonly IronqrTraceEvent[]): IronqrTraceSummary => {
  const counts: IronqrTraceSummary = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
};

const countAttemptFailures = (
  trace: IronqrTraceSource,
  failure: 'timing-check' | 'decode_failed' | 'internal_error',
): number => {
  if ('events' in trace) {
    return trace.events.filter(
      (event) => event.type === 'decode-attempt-failed' && event.failure === failure,
    ).length;
  }
  return 0;
};

const createIronqrTrace = (mode: IronqrTraceMode): IronqrTraceSource | null => {
  switch (mode) {
    case 'off':
      return null;
    case 'full':
      return createTraceCollector();
    default:
      return createTraceCounter();
  }
};

const scanWithIronqr = async (
  asset: Parameters<AccuracyEngine['scan']>[0],
  options: AccuracyEngineRunOptions = {},
): Promise<AccuracyScanResult> => {
  const traceMode = options.ironqrTraceMode ?? 'summary';
  const trace = createIronqrTrace(traceMode);
  try {
    const image = await asset.loadImage();
    const allowMultiple = asset.expectedTexts.length > 1;
    const results = await scanFrame(image as never, {
      allowMultiple,
      ...(trace === null ? {} : { traceSink: trace }),
    });
    const diagnostics = trace === null ? null : summarizeIronqrTrace(trace, traceMode);
    if (results.length === 0) {
      return successResult(
        [],
        trace === null
          ? 'no_decode'
          : classifyIronqrFailure('counts' in trace ? trace.counts : trace.events),
        diagnostics,
      );
    }
    return successResult(
      results.map((result) => ({
        text: result.payload.text,
        ...(result.payload.kind ? { kind: result.payload.kind } : {}),
      })),
      null,
      diagnostics,
    );
  } catch (error) {
    return failureResult(
      error,
      'engine_error',
      trace === null ? null : summarizeIronqrTrace(trace, traceMode),
    );
  }
};

export const ironqrAccuracyEngine: AccuracyEngine = {
  id: 'ironqr',
  kind: 'first-party',
  capabilities: createCapabilities({
    multiCode: true,
    inversion: 'native',
    rotation: 'native',
    runtime: 'js',
  }),
  cache: createCachePolicy({ enabled: true, version: 'live-pass-v1', mode: 'pass-only' }),
  availability: createAvailableAvailability,
  scan: scanWithIronqr,
};
