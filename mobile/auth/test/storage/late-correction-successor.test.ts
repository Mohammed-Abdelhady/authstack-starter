import {
  REFRESH_BEFORE_TOKEN,
  REFRESH_SUCCESSOR_TOKEN,
  REFRESH_ROTATED_TOKEN,
} from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { makeRefreshRecord } from '../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../src/runtime/runtime';
import type { RuntimeTokens } from '../../src/types/record';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../support/support';

const INSTALL_DIGEST = 'install-digest';

describe('late credential correction with a successor record', () => {
  it('keeps a successor record that appears before a disposed correction guard read', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const previous: RuntimeTokens = {
      accessToken: 'access-before',
      refreshToken: REFRESH_BEFORE_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId: 'lineage-one',
    };
    runtime.installDigest = INSTALL_DIGEST;
    runtime.tokens = previous;
    runtime.record = makeRefreshRecord(runtime, INSTALL_DIGEST, previous);
    runtime.setState('signedIn', 'exchanging');
    ports.credentials.value = JSON.stringify(runtime.record);
    const successor = makeRefreshRecord(runtime, INSTALL_DIGEST, {
      accessToken: 'access-successor',
      refreshToken: REFRESH_SUCCESSOR_TOKEN,
      lineageId: 'lineage-one',
    });
    const successorValue = JSON.stringify(successor);
    const replaceStarted = new Deferred<void>();
    const releaseReplace = new Deferred<void>();
    ports.credentials.beforeReplace = async (value) => {
      if (!value.includes(REFRESH_ROTATED_TOKEN)) return;
      replaceStarted.resolve();
      await releaseReplace.promise;
    };
    ports.credentials.afterReplace = (value) => {
      if (value.includes(REFRESH_ROTATED_TOKEN)) ports.credentials.value = successorValue;
    };
    const rotated: RuntimeTokens = {
      accessToken: 'access-rotated',
      refreshToken: REFRESH_ROTATED_TOKEN,
      expiresAt: 0,
      version: 2,
      lineageId: 'lineage-one',
    };
    const replacing = runtime.replaceRecord(
      makeRefreshRecord(runtime, INSTALL_DIGEST, rotated),
      runtime.epoch,
      { kind: 'delete' },
      {
        kind: 'session',
        installDigest: INSTALL_DIGEST,
        refreshToken: REFRESH_ROTATED_TOKEN,
        lineageId: 'lineage-one',
      },
    );

    await replaceStarted.promise;
    runtime.dispose();
    releaseReplace.resolve();
    await expect(replacing).rejects.toMatchObject({ operation: 'credentials.replace' });
    await runtime.writeTail;
    expect(ports.credentials.value).toBe(successorValue);
    expect(ports.credentials.events.filter((event) => event === 'delete:start')).toHaveLength(0);
    expect(ports.timer.pendingDelays).toEqual([]);
  });
});
