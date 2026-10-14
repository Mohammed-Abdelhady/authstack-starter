import {
  REFRESH_WITHOUT_LINEAGE_TOKEN,
  REFRESH_SENT_TOKEN,
  REFRESH_SUCCESSOR_TOKEN,
  REFRESH_LATE_TOKEN,
} from '../../support/token-values';
import { createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { classifyDisposedCredentialRecord } from '../../../src/storage/credential-record-store';
import { settleDisposedToken } from '../../../src/refresh/refresh-dispose';
import { AuthRuntime } from '../../../src/runtime/runtime';
import { CONFIG, ScriptedTransport, testPorts } from '../../support/support';

const INSTALL_DIGEST = 'lineage-classification-install';

describe('disposed lineage classification', () => {
  it('treats an unlineaged record as foreign even when both sides lack a lineage', async () => {
    const ports = testPorts(new ScriptedTransport());
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = INSTALL_DIGEST;
    ports.credentials.value = JSON.stringify({
      schemaVersion: 1,
      serverBaseAddress: CONFIG.serverBaseAddress,
      environment: CONFIG.environment,
      clientId: CONFIG.clientId,
      installDigest: INSTALL_DIGEST,
      tokens: { refreshToken: REFRESH_WITHOUT_LINEAGE_TOKEN },
    });

    await expect(
      classifyDisposedCredentialRecord(runtime, {
        kind: 'session',
        installDigest: INSTALL_DIGEST,
        refreshToken: REFRESH_WITHOUT_LINEAGE_TOKEN,
      }),
    ).resolves.toBe('FOREIGN');
    expect(ports.timer.pending).toBe(0);
  });

  it.each([
    ['my sent predecessor', REFRESH_SENT_TOKEN, 'FOREIGN'],
    ['a later refresh in my lineage', REFRESH_SUCCESSOR_TOKEN, 'OWN_OTHER'],
    ['my own late token', REFRESH_LATE_TOKEN, 'OWN_SAME'],
  ] as const)('classifies %s when settling a late token', async (_name, storedToken, expected) => {
    const ports = testPorts(new ScriptedTransport());
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = INSTALL_DIGEST;
    ports.credentials.value = JSON.stringify({
      schemaVersion: 1,
      serverBaseAddress: CONFIG.serverBaseAddress,
      environment: CONFIG.environment,
      clientId: CONFIG.clientId,
      installDigest: INSTALL_DIGEST,
      lineageId: 'lineage-one',
      tokens: { refreshToken: storedToken },
      refreshInFlight: true,
    });

    await expect(
      classifyDisposedCredentialRecord(runtime, {
        kind: 'session',
        installDigest: INSTALL_DIGEST,
        refreshToken: REFRESH_LATE_TOKEN,
        sentRefreshToken: REFRESH_SENT_TOKEN,
        lineageId: 'lineage-one',
      }),
    ).resolves.toBe(expected);
    expect(ports.timer.pending).toBe(0);
  });

  it('keeps an already stored late token without revoking it', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    runtime.installDigest = INSTALL_DIGEST;
    const serialized = JSON.stringify({
      schemaVersion: 1,
      serverBaseAddress: CONFIG.serverBaseAddress,
      environment: CONFIG.environment,
      clientId: CONFIG.clientId,
      installDigest: INSTALL_DIGEST,
      lineageId: 'lineage-one',
      tokens: { refreshToken: REFRESH_LATE_TOKEN },
    });
    ports.credentials.value = serialized;

    await settleDisposedToken(
      runtime,
      createApiClient(transport),
      INSTALL_DIGEST,
      'lineage-one',
      REFRESH_LATE_TOKEN,
      REFRESH_SENT_TOKEN,
    );

    expect(ports.credentials.value).toBe(serialized);
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });
});
