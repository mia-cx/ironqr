import process from 'node:process';
import {
  createBenchDashboardModel,
  onDashboardAssetPrepared,
  onDashboardAssetsStarted,
  onDashboardBenchmarkStarted,
  onDashboardDone,
  onDashboardImageLoadFinished,
  onDashboardImageLoadStarted,
  onDashboardManifestLoaded,
  onDashboardManifestStarted,
  onDashboardScanFinished,
  onDashboardScanStarted,
} from './dashboard/model.js';
import { BenchOpenTuiDashboard } from './opentui.js';
import type { EngineAssetResult } from './types.js';

export interface AccuracyProgressReporter {
  onManifestStarted: () => void;
  onManifestLoaded: (
    assetCount: number,
    engineIds: readonly string[],
    cacheEnabled: boolean,
    totals?: { readonly positiveCount: number; readonly negativeCount: number },
  ) => void;
  onAssetsStarted: (assetCount: number) => void;
  onAssetPrepared: (assetId: string, prepared: number, total: number) => void;
  onBenchmarkStarted: (
    assetCount: number,
    engineIds: readonly string[],
    workerCount: number,
  ) => void;
  onScanStarted: (event: {
    readonly engineId: string;
    readonly assetId: string;
    readonly relativePath: string;
    readonly label?: EngineAssetResult['label'];
    readonly cached: boolean;
    readonly cacheable: boolean;
  }) => void;
  onImageLoadStarted: (event: {
    readonly engineId: string;
    readonly assetId: string;
    readonly relativePath: string;
    readonly label?: EngineAssetResult['label'];
  }) => void;
  onImageLoadFinished: (event: {
    readonly engineId: string;
    readonly assetId: string;
    readonly width: number;
    readonly height: number;
  }) => void;
  onScanFinished: (event: {
    readonly engineId: string;
    readonly assetId: string;
    readonly relativePath: string;
    readonly result: EngineAssetResult;
    readonly wroteToCache: boolean;
  }) => void;
  stop: () => void;
}

export const createAccuracyProgressReporter = (options: {
  readonly enabled: boolean;
  readonly stderr?: NodeJS.WriteStream;
}): AccuracyProgressReporter => {
  const stderr = options.stderr ?? process.stderr;
  const enabled = options.enabled && stderr.isTTY;

  let stopped = false;
  const dashboard = createBenchDashboardModel();
  const openTui = enabled ? new BenchOpenTuiDashboard(dashboard) : null;

  const queueRender = (): void => {
    openTui?.update();
  };

  openTui?.start();

  return {
    onManifestStarted: () => {
      onDashboardManifestStarted(dashboard);
      queueRender();
    },
    onManifestLoaded: (nextAssetCount, engineIds, nextCacheEnabled, totals) => {
      onDashboardManifestLoaded(dashboard, nextAssetCount, engineIds, nextCacheEnabled, totals);
      queueRender();
    },
    onAssetsStarted: (nextAssetCount) => {
      onDashboardAssetsStarted(dashboard, nextAssetCount);
      queueRender();
    },
    onAssetPrepared: (assetId, prepared, total) => {
      onDashboardAssetPrepared(dashboard, assetId, prepared, total);
      queueRender();
    },
    onBenchmarkStarted: (nextAssetCount, engineIds, nextWorkerCount) => {
      onDashboardBenchmarkStarted(dashboard, nextAssetCount, engineIds, nextWorkerCount);
      queueRender();
    },
    onScanStarted: ({ engineId, assetId, relativePath, label, cached, cacheable }) => {
      onDashboardScanStarted(dashboard, {
        engineId,
        assetId,
        relativePath,
        ...(label === undefined ? {} : { label }),
        cached,
        cacheable,
      });
      queueRender();
    },
    onImageLoadStarted: ({ engineId, assetId, relativePath, label }) => {
      onDashboardImageLoadStarted(dashboard, {
        engineId,
        assetId,
        relativePath,
        ...(label === undefined ? {} : { label }),
      });
      queueRender();
    },
    onImageLoadFinished: ({ engineId, assetId }) => {
      onDashboardImageLoadFinished(dashboard, { engineId, assetId });
      queueRender();
    },
    onScanFinished: ({ engineId, assetId, relativePath, result, wroteToCache }) => {
      onDashboardScanFinished(dashboard, { engineId, assetId, relativePath, result, wroteToCache });
      queueRender();
    },
    stop: () => {
      if (stopped) return;
      onDashboardDone(dashboard);
      openTui?.stop();
      stopped = true;
    },
  };
};
