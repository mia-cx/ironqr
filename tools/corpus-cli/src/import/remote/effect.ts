import { Effect } from 'effect';

/** Wraps a promise-returning thunk in an `Effect`, normalising thrown values to `Error`. */
export const tryPromise = <A>(evaluate: () => Promise<A>) => {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
};
