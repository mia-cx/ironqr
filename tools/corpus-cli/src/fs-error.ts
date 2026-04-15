/** Return `true` if `error` is a Node.js `ENOENT` filesystem error (file not found). */
export const isEnoentError = (error: unknown): boolean => {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
};
