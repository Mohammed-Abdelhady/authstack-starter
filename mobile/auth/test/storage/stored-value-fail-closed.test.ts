import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  ScriptedTransport,
  apiReply,
  oauthTokenReply,
  testPorts,
} from '../support/support';

// 32 zero bytes, base64url: the install digest when the hash port answers zeros.
const ZERO_DIGEST = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// A session as builds before the envelope stored it, written out by hand.
const TODAY_RECORD =
  '{"schemaVersion":1,"serverBaseAddress":"https://api.example.test","environment":"test",' +
  `"clientId":"native-client","installDigest":"${ZERO_DIGEST}","lineageId":"lineage-today",` +
  '"tokens":{"refreshToken":"refresh-today"}}';

/** A well-formed waiting entry of the lineage `lineage-dup`, written out by hand. */
function waitingEntry(refreshToken: string): string {
  return (
    '{"serverBaseAddress":"https://api.example.test","environment":"test",' +
    '"clientId":"native-client","installDigest":"d","lineageId":"lineage-dup",' +
    `"refreshToken":"${refreshToken}","attempts":0,"nextAttemptAt":0,"refreshExpiresAt":null}`
  );
}

function engineOn(value: string) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  ports.crypto.hashOverride = () => new Uint8Array(32);
  ports.credentials.value = value;
  return { transport, ports, engine: createAuthEngine(CONFIG, ports) };
}

describe('stored values from earlier builds and corrupt ones', () => {
  it('restores a session stored in the format before the envelope', async () => {
    const { transport, engine } = engineOn(TODAY_RECORD);
    transport.enqueue(oauthTokenReply('access-migrated', 'refresh-migrated'), apiReply({}));

    await expect(engine.restore()).resolves.toEqual({ kind: 'restored', status: 'signedIn' });
    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(transport.sent[0]?.body).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-today',
    });
    expect(transport.sent[1]?.headers?.['Authorization']).toBe('Bearer access-migrated');
  });

  it.each([
    ['invalid JSON', '{"schemaVersion":1,"tokens":'],
    [
      'a session without its install digest',
      TODAY_RECORD.replace(`"installDigest":"${ZERO_DIGEST}",`, ''),
    ],
    ['a mistyped client', TODAY_RECORD.replace('"clientId":"native-client"', '"clientId":7')],
    [
      'a mistyped refresh token',
      TODAY_RECORD.replace('"refreshToken":"refresh-today"', '"refreshToken":42'),
    ],
    [
      'an envelope whose waiting list is not a list',
      TODAY_RECORD.replace('{', '{"version":1,"pendingRevocations":"none",'),
    ],
    [
      'an envelope with two waiting entries for one lineage',
      TODAY_RECORD.replace(
        '{',
        `{"version":1,"pendingRevocations":[${waitingEntry('token-a')},${waitingEntry('token-b')}],`,
      ),
    ],
    [
      'an envelope whose waiting entry has no token',
      TODAY_RECORD.replace(
        '{',
        '{"version":1,"pendingRevocations":[{"serverBaseAddress":"https://api.example.test",' +
          '"environment":"test","clientId":"native-client","installDigest":"d","attempts":0,' +
          '"nextAttemptAt":0,"refreshExpiresAt":null}],',
      ),
    ],
  ])('fails closed on %s: signed out, reason kept, no token reused', async (_name, value) => {
    const { transport, ports, engine } = engineOn(value);

    await expect(engine.restore()).resolves.toEqual({ kind: 'restored', status: 'signedOut' });
    await expect(engine.refresh()).resolves.toEqual({ kind: 'notSignedIn' });

    expect(engine.snapshot).toEqual({
      status: 'signedOut',
      operation: 'none',
      reason: 'invalidRecord',
    });
    expect(transport.sent).toEqual([]);
    expect(ports.credentials.value).toBeUndefined();
  });
});
