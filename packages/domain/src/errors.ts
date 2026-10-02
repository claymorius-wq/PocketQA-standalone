import type { ErrorCode } from '@pocket-qa/contracts';

/** A rule violation with an API error code; the API maps it straight to `{code, message}`. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const conflict = (message: string) => new DomainError('CONFLICT_STATE', message);
