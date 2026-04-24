export interface PerformanceBenchmarkResult {
  readonly implemented: false;
  readonly message: string;
}

export const runPerformanceBenchmark = async (): Promise<PerformanceBenchmarkResult> => {
  return {
    implemented: false,
    message: 'performance benchmark is not implemented yet; use `bench accuracy` for now',
  };
};
