import { Effect } from 'effect';
import { type FetchLike, fetchText } from './fetch.js';
import { extractPageLinks } from './html.js';
import type { SourcePage } from './page.js';

interface ResolveSourcePagesEnv {
  readonly fetchImpl: FetchLike;
  readonly log: (line: string) => void;
  readonly fetchDelayMs: number;
}

interface ResolveSourcePagesState {
  readonly seenPages: Set<string>;
  readonly yieldedLeaves: Set<string>;
  /** URLs of detail pages already fully processed in previous scrape runs. */
  readonly visitedSourcePageUrls?: ReadonlySet<string>;
}

const MAX_RESOLVE_DEPTH = 3;

export const resolveSourcePages = (
  page: SourcePage,
  env: ResolveSourcePagesEnv,
  state: ResolveSourcePagesState,
  depth = 0,
): AsyncGenerator<SourcePage> => {
  return (async function* () {
    const yieldLeaf = async function* (leaf: SourcePage): AsyncGenerator<SourcePage> {
      if (state.yieldedLeaves.has(leaf.url)) {
        return;
      }

      state.yieldedLeaves.add(leaf.url);
      env.log(`Source page ready ${leaf.url}`);
      yield leaf;
    };

    if (state.seenPages.has(page.url) || depth >= MAX_RESOLVE_DEPTH) {
      yield* yieldLeaf(page);
      return;
    }

    state.seenPages.add(page.url);
    const isSeedPage = depth === 0;
    const pageLinks = extractPageLinks(page.url, page.html, isSeedPage);
    if (pageLinks.length === 0) {
      yield* yieldLeaf(page);
      return;
    }

    env.log(`Walking ${pageLinks.length} page link(s) from ${page.url}`);

    for (const pageLink of pageLinks) {
      if (state.visitedSourcePageUrls?.has(pageLink)) {
        env.log(`Skipped ${pageLink}: visited in a previous scrape`);
        continue;
      }
      env.log(`Fetching page ${pageLink}`);
      await new Promise((r) => setTimeout(r, env.fetchDelayMs));
      let nextPage: SourcePage | null;
      try {
        nextPage = await Effect.runPromise(fetchText(pageLink, env.fetchImpl, true));
      } catch (error) {
        env.log(
          `Skipped page ${pageLink}: ${error instanceof Error ? error.message : String(error)}`,
        );
        nextPage = null;
      }

      if (nextPage === null) {
        continue;
      }

      for await (const leaf of resolveSourcePages(nextPage, env, state, depth + 1)) {
        yield leaf;
      }
    }
  })();
};
