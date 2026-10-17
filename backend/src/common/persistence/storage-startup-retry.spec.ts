import {
  PersistenceUnavailableError,
  UniqueConflictError,
} from './persistence-errors';
import { StorageNotReadyError } from './storage-startup';
import { retryStorageStartup } from './storage-startup-retry';

describe('retryStorageStartup', () => {
  const unavailable = () =>
    new PersistenceUnavailableError('Database unavailable');

  it('retries transient connection failures within the shared attempt bound', async () => {
    const work = jest
      .fn()
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce('ready');
    const pause = jest.fn().mockResolvedValue(undefined);

    await expect(retryStorageStartup(work, pause)).resolves.toBe('ready');
    expect(work).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('stops after the finite attempt budget', async () => {
    const work = jest.fn().mockRejectedValue(unavailable());
    const pause = jest.fn().mockResolvedValue(undefined);

    await expect(retryStorageStartup(work, pause)).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
    expect(work).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('does not retry schema mismatch or another non-transient failure', async () => {
    const pause = jest.fn().mockResolvedValue(undefined);
    for (const error of [
      new StorageNotReadyError('schema mismatch'),
      new UniqueConflictError('session.token_hash'),
      new Error('unknown'),
    ]) {
      const work = jest.fn().mockRejectedValue(error);
      await expect(retryStorageStartup(work, pause)).rejects.toBe(error);
      expect(work).toHaveBeenCalledTimes(1);
    }
    expect(pause).not.toHaveBeenCalled();
  });
});
