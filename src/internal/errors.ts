export class ScannerError extends Error {
  constructor(
    public readonly code: 'not_implemented' | 'invalid_input' | 'decode_failed' | 'internal_error',
    message: string,
  ) {
    super(message);
    this.name = 'ScannerError';
  }
}
