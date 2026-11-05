import type {
  PersonalCommandCode,
  PersonalCommandResult,
} from './personal-progress.model';

export const persistedResult = <T>(
  operationId: string,
  value: T,
): PersonalCommandResult<T> => ({ status: 'persisted', operationId, value });

export const rejectedResult = (
  operationId: string,
  code: PersonalCommandCode,
): PersonalCommandResult<never> => ({ status: 'rejected', operationId, code });

export const failedResult = (
  operationId: string,
  error: unknown,
): PersonalCommandResult<never> => ({
  status: 'failed',
  operationId,
  retryable: true,
  message: error instanceof Error ? error.message : 'Operation failed',
});
