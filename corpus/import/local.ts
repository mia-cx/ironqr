import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readCorpusManifest, writeCorpusManifest } from '../manifest.js';
import type {
  CorpusAsset,
  ImportLocalAssetOptions,
  ImportLocalAssetResult,
  LocalSource,
} from '../schema.js';
import { importAssetBytes, mediaTypeFromExtension } from './store.js';

function buildSourceRecord(sourcePath: string, options: ImportLocalAssetOptions): LocalSource {
  return {
    kind: 'local',
    originalPath: sourcePath,
    importedAt: new Date().toISOString(),
    ...(options.attribution ? { attribution: options.attribution } : {}),
    ...(options.license ? { license: options.license } : {}),
    ...(options.provenanceNotes ? { notes: options.provenanceNotes } : {}),
  };
}

export async function importLocalAssets(
  options: ImportLocalAssetOptions,
): Promise<ImportLocalAssetResult> {
  const manifest = await readCorpusManifest(options.repoRoot);
  const assets = [...manifest.assets];
  const imported: CorpusAsset[] = [];
  const deduped: CorpusAsset[] = [];

  for (const inputPath of options.paths) {
    const absolutePath = path.resolve(inputPath);
    const extension = path.extname(absolutePath).toLowerCase();
    const mediaType = mediaTypeFromExtension(extension);

    if (!mediaType) {
      throw new Error(`Unsupported image extension: ${extension || '<none>'}`);
    }

    const bytes = await readFile(absolutePath);
    const source = buildSourceRecord(absolutePath, options);
    const result = await importAssetBytes({
      repoRoot: options.repoRoot,
      assets,
      bytes,
      mediaType,
      sourcePathForExtension: absolutePath,
      label: options.label,
      provenance: source,
      ...(options.reviewStatus ? { reviewStatus: options.reviewStatus } : {}),
      ...(options.reviewer ? { reviewer: options.reviewer } : {}),
      ...(options.reviewNotes ? { reviewNotes: options.reviewNotes } : {}),
    });

    if (result.deduped) {
      deduped.push(result.asset);
    } else {
      imported.push(result.asset);
    }
  }

  const nextManifest = { version: 1 as const, assets };
  await writeCorpusManifest(options.repoRoot, nextManifest);

  return {
    imported,
    deduped,
    manifest: nextManifest,
  };
}
