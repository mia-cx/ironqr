/**
 * A backpressure-free async queue that bridges push-based producers with async-iteration consumers.
 * Call `push` to enqueue items and `close` when the producer is done.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }

    this.items.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) break;
      waiter({ value: undefined, done: true } as IteratorResult<T>);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift()!, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true } as IteratorResult<T>);
        }

        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
