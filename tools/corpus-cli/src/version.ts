import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const MAJOR_VERSION = Number(pkg.version.split('.')[0]);

export const assertCompatibleVersion = (fileVersion: number, filePath: string): void => {
  if (fileVersion !== MAJOR_VERSION) {
    throw new Error(
      `Incompatible file version: ${filePath} has version ${fileVersion}, but corpus-cli is at major version ${MAJOR_VERSION}. ` +
        `Re-run with a compatible version of corpus-cli or migrate the file.`,
    );
  }
};
