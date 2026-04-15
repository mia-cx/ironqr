/** Return `true` when both stdin and stdout are connected to a TTY. */
export const isInteractiveSession = (
  stdin: Pick<NodeJS.ReadStream, 'isTTY'> = process.stdin,
  stdout: Pick<NodeJS.WriteStream, 'isTTY'> = process.stdout,
): boolean => {
  return Boolean(stdin.isTTY && stdout.isTTY);
};

/** Throw with `message` if the current process is not running in an interactive TTY. */
export const assertInteractiveSession = (message: string): void => {
  if (!isInteractiveSession()) {
    throw new Error(message);
  }
};
