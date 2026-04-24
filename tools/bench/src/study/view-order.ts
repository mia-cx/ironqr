import type { StudyPlugin } from './types.js';

interface ViewOrderSummary extends Record<string, unknown> {
  readonly recommendation: readonly string[];
  readonly evidence: string;
  readonly assetCount: number;
}

export const viewOrderStudyPlugin: StudyPlugin<ViewOrderSummary> = {
  id: 'view-order',
  title: 'IronQR view-order study',
  description:
    'Recommends proposal-view ordering from the current corpus sample and latest performance evidence.',
  version: 'study-v1',
  flags: [
    {
      name: 'max-assets',
      type: 'number',
      description: 'Limit approved corpus assets processed by the study.',
    },
  ],
  run: async (context) => {
    const summary = {
      recommendation: ['current-order'],
      evidence:
        'No dedicated proposal-view timing metrics are available yet; keep the current order and use this report as the stable study execution contract.',
      assetCount: context.assets.length,
    };
    context.log(`view-order study inspected ${context.assets.length} sampled asset(s)`);
    return {
      pluginId: 'view-order',
      assetCount: context.assets.length,
      summary,
      report: {
        sampledAssets: context.assets.map((asset) => ({
          id: asset.id,
          label: asset.label,
          relativePath: asset.relativePath,
          expectedTextCount: asset.expectedTexts.length,
        })),
        recommendation: summary.recommendation,
        evidence: summary.evidence,
      },
    };
  },
};
