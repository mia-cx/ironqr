import type { ScanProposal } from './proposals.js';
import type { BinaryViewId } from './views.js';

const DEFAULT_MAX_CLUSTER_REPRESENTATIVES = 3;
const PROPOSAL_CLUSTER_QUANTIZATION = 24;

/**
 * One grouped QR candidate spanning multiple near-duplicate proposals.
 */
export interface ProposalCluster {
  /** Stable cluster id derived from proposal geometry. */
  readonly id: string;
  /** Best-first ranked proposals that collapsed into the cluster. */
  readonly proposals: readonly ScanProposal[];
  /** Diverse representative proposals to probe before spending more budget. */
  readonly representatives: readonly ScanProposal[];
  /** Score of the strongest proposal in the cluster. */
  readonly bestProposalScore: number;
}

/**
 * Cluster-construction options.
 */
export interface ProposalClusterOptions {
  /** Maximum representative proposals retained per cluster. */
  readonly maxRepresentatives?: number;
}

/**
 * Groups ranked proposals into coarse QR-candidate clusters and selects a small
 * diverse representative set for each cluster.
 *
 * @param proposals - Best-first ranked proposals.
 * @param options - Representative budgeting options.
 * @returns Best-first candidate clusters.
 */
export const clusterRankedProposals = (
  proposals: readonly ScanProposal[],
  options: ProposalClusterOptions = {},
): readonly ProposalCluster[] => {
  const maxRepresentatives = options.maxRepresentatives ?? DEFAULT_MAX_CLUSTER_REPRESENTATIVES;
  const grouped = new Map<string, ScanProposal[]>();

  for (const proposal of proposals) {
    const clusterId = proposalClusterKey(proposal);
    const existing = grouped.get(clusterId);
    if (existing) {
      existing.push(proposal);
      continue;
    }
    grouped.set(clusterId, [proposal]);
  }

  return [...grouped.entries()]
    .map(([id, clusterProposals]) => {
      const orderedProposals = [...clusterProposals].sort(
        (left, right) => right.proposalScore - left.proposalScore,
      );
      const representatives = selectClusterRepresentatives(orderedProposals, maxRepresentatives)
        .slice()
        .sort((left, right) => right.proposalScore - left.proposalScore);
      return {
        id,
        proposals: orderedProposals,
        representatives,
        bestProposalScore: orderedProposals[0]?.proposalScore ?? 0,
      };
    })
    .sort((left, right) => right.bestProposalScore - left.bestProposalScore);
};

const proposalClusterKey = (proposal: ScanProposal): string => {
  const points = proposal.kind === 'finder-triple' ? proposal.finders : proposal.finderLikeEvidence;
  const xs = points.map((finder) => finder.centerX);
  const ys = points.map((finder) => finder.centerY);
  const centroidX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const centroidY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return [
    proposal.estimatedVersions[0] ?? 0,
    Math.round(centroidX / PROPOSAL_CLUSTER_QUANTIZATION),
    Math.round(centroidY / PROPOSAL_CLUSTER_QUANTIZATION),
    Math.round(width / PROPOSAL_CLUSTER_QUANTIZATION),
    Math.round(height / PROPOSAL_CLUSTER_QUANTIZATION),
  ].join(':');
};

const selectClusterRepresentatives = (
  proposals: readonly ScanProposal[],
  maxRepresentatives: number,
): readonly ScanProposal[] => {
  const budget = Math.max(1, maxRepresentatives);
  const selected: ScanProposal[] = [];
  const seenIds = new Set<string>();
  const seenFamilies = new Set<string>();
  const seenProfiles = new Set<string>();

  const push = (proposal: ScanProposal): void => {
    if (selected.length >= budget || seenIds.has(proposal.id)) return;
    seenIds.add(proposal.id);
    selected.push(proposal);
  };

  const first = proposals[0];
  if (first) {
    push(first);
    seenFamilies.add(viewFamilyKey(first.binaryViewId));
    seenProfiles.add(viewProfileKey(first.binaryViewId));
  }

  for (const proposal of proposals) {
    if (selected.length >= budget) break;
    const family = viewFamilyKey(proposal.binaryViewId);
    if (seenFamilies.has(family)) continue;
    push(proposal);
    seenFamilies.add(family);
    seenProfiles.add(viewProfileKey(proposal.binaryViewId));
  }

  for (const proposal of proposals) {
    if (selected.length >= budget) break;
    const profile = viewProfileKey(proposal.binaryViewId);
    if (seenProfiles.has(profile)) continue;
    push(proposal);
    seenProfiles.add(profile);
  }

  for (const proposal of proposals) {
    if (selected.length >= budget) break;
    push(proposal);
  }

  return selected;
};

const viewFamilyKey = (binaryViewId: BinaryViewId): string => {
  const [scalarViewId] = binaryViewId.split(':') as [string, string, string];
  if (scalarViewId === 'gray') return 'gray';
  if (scalarViewId === 'oklab-l') return 'oklab-l';
  if (scalarViewId.startsWith('oklab')) return 'oklab-chroma';
  return 'rgb';
};

const viewProfileKey = (binaryViewId: BinaryViewId): string => {
  const [scalarViewId, threshold, polarity] = binaryViewId.split(':') as [string, string, string];
  return `${viewFamilyKey(binaryViewId)}:${threshold}:${polarity}:${scalarViewId}`;
};
