import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { MAIL_CATALOGUES } from '../../../mail/catalog/mail-catalogue';
import { ApplicationRegistry } from '../../../session/applications/application-registry';
import type { RegisteredClient } from '../../../session/applications/application-registry.store';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../../session/constants/client-ids';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import {
  ACCOUNT_ID,
  mailedCode,
  OLD_ADDRESS,
  ownEmailWorld,
  OwnEmailWorld,
} from '../testing/own-email-world.harness-spec';
import { NativeEmailChangeService } from './native-email-change.service';

jest.mock('nodemailer');

const NEW_ADDRESS = 'new@example.test';
const APP_CLIENT = 'com.example.app';
const CHANGED_SUBJECT = MAIL_CATALOGUES.en.securityNotice.emailChangedSubject;

/** Only what the check reads; the rest of a registration plays no part. */
function client(fields: Partial<RegisteredClient>): RegisteredClient {
  return partialMock<RegisteredClient>({
    clientId: APP_CLIENT,
    platform: APPLICATION_PLATFORM.NATIVE,
    clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
    enabled: true,
    ...fields,
  });
}

const NATIVE_APP = client({});

function nativeChanges(
  world: OwnEmailWorld,
  client: RegisteredClient | null,
  nativeEnabled = true,
): NativeEmailChangeService {
  return new NativeEmailChangeService(
    partialMock<ApplicationRegistry>({
      lookUpClient: () => Promise.resolve(client),
    }),
    partialMock<AuthEpochService>({ nativeEnabled: () => nativeEnabled }),
    world.staffConfirmation,
  );
}

describe('NativeEmailChangeService', () => {
  let world: OwnEmailWorld;
  let code: string;

  beforeEach(async () => {
    world = ownEmailWorld();
    await world.requests.request(world.caller(), NEW_ADDRESS);
    code = mailedCode((await world.sent()).find((m) => m.to === NEW_ADDRESS));
  });

  it('confirms for a signed-out person through an enabled native app, and ends every session', async () => {
    const changes = nativeChanges(world, NATIVE_APP);

    await changes.confirm({ clientId: APP_CLIENT, email: NEW_ADDRESS, code });

    expect(world.accounts.row(ACCOUNT_ID)).toMatchObject({
      email: NEW_ADDRESS,
      pendingEmail: undefined,
    });
    expect(world.sessions.liveOf(ACCOUNT_ID)).toEqual([]);
    expect(world.sessions.revocations).toEqual([
      { userId: ACCOUNT_ID, reason: REVOKED_REASON.ADMIN_FORCED },
    ]);
    const notices = (await world.sent()).filter(
      (mail) => mail.subject === CHANGED_SUBJECT,
    );
    expect(notices.map((mail) => mail.to)).toEqual([OLD_ADDRESS]);
  });

  it.each([
    ['an unknown client', null, true],
    ['a disabled app', client({ enabled: false }), true],
    ['a web client', client({ platform: APPLICATION_PLATFORM.WEB }), true],
    [
      'a confidential client',
      client({ clientType: APPLICATION_CLIENT_TYPE.CONFIDENTIAL }),
      true,
    ],
    ['an app while native sign-in is off', NATIVE_APP, false],
  ])(
    'refuses %s before the code is counted',
    async (_client, client, nativeEnabled) => {
      const changes = nativeChanges(world, client, nativeEnabled);

      await expect(
        changes.confirm({ clientId: APP_CLIENT, email: NEW_ADDRESS, code }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(world.accounts.row(ACCOUNT_ID).email).toBe(OLD_ADDRESS);
      expect([...world.codes.records.values()][0]?.attempts).toBe(0);
    },
  );

  it('answers a wrong code and a code for another address with the one shared error', async () => {
    const changes = nativeChanges(world, NATIVE_APP);
    const wrong = code === '000000' ? '111111' : '000000';

    for (const attempt of [
      { email: NEW_ADDRESS, code: wrong },
      { email: 'elsewhere@example.test', code },
    ]) {
      await expect(
        changes.confirm({ clientId: APP_CLIENT, ...attempt }),
      ).rejects.toMatchObject({ code: ErrorCode.ACTIVATION_CODE_INVALID });
    }
    expect(world.accounts.row(ACCOUNT_ID).email).toBe(OLD_ADDRESS);
  });
});
