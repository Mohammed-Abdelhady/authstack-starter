import { ConfigService } from '@nestjs/config';
import { PasskeyConfigService } from '../services/passkey-config.service';
import { LegacyPasskeyFacts } from '../services/legacy-passkey-facts';
import { rerunAtOnce } from '../../../../test/utils/session/issuance-contract/issuance-contract-support';
import {
  browser,
  credential,
  CREDENTIAL_ID,
  NOW,
  OTHER_CREDENTIAL_ID,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  PASSWORD,
  refusalOf,
  signInBrowser,
} from './passkeys-contract.harness-spec';
import {
  APP_RP_ID,
  appSession,
  nativeRegistration,
  WEB_RP_ID,
} from './passkeys-contract-native.harness-spec';
import { relyingPartyScope } from '../utils/relying-party.util';
// feature:email-code:start
import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../../session/constants/client-ids';
import {
  type EmailCodeApplications,
  type EmailCodeGrants,
  SignInMethodRule,
} from '../../../user/services/sign-in-method.rule';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { PasskeyManagementService } from '../services/passkey-management.service';
import { APP_CLIENT_ID } from './passkeys-contract-native.harness-spec';
import { noRequiredRelyingParties } from '../services/browser-passkey-policy.harness-spec';
// feature:email-code:end

const LAST_WAY_IN = { code: 'PASSKEY_LAST_SIGN_IN_METHOD', status: 409 };
/** By credential id it sorts before both fixture credentials. */
const THIRD_CREDENTIAL_ID = 'Y3JlZGVudGlhbC10aHJlZQ';
const VERIFICATION_FAILED = {
  code: 'PASSKEY_VERIFICATION_FAILED',
  status: 401,
};

/** An account with a passkey stored before 0026 and one made in the app. */
async function seedBothRelyingParties(
  harness: PasskeysHarnessSource,
  ownerId: string,
): Promise<void> {
  await harness().seedPasskey({
    userId: ownerId,
    credentialId: CREDENTIAL_ID,
    createdAt: NOW,
  });
  await harness().seedPasskey({
    userId: ownerId,
    credentialId: OTHER_CREDENTIAL_ID,
    createdAt: NOW,
    rpId: APP_RP_ID,
  });
}

/** Each passkey belongs to one relying party, and only that one counts or uses it. */
export function relyingPartyCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('counts one passkey for each relying party, an unmarked one as the web one', async () => {
    const { ownerId } = fixture();
    await seedBothRelyingParties(harness, ownerId);
    const facts = new LegacyPasskeyFacts(
      harness().passkeys,
      new PasskeyConfigService(
        new ConfigService({ passkeys: { rpId: WEB_RP_ID } }),
      ),
    );

    const counts = await harness()
      .runner(rerunAtOnce)
      .run(async (unitOfWork) => [
        await facts.countForRelyingParty(unitOfWork, ownerId, WEB_RP_ID),
        await facts.countForRelyingParty(unitOfWork, ownerId, APP_RP_ID),
        await facts.countForRelyingParty(unitOfWork, ownerId, 'other.test'),
      ]);

    expect(counts).toEqual([1, 1, 0]);
    // By credential id: the app one sorts first.
    expect(await harness().storedRelyingParties()).toEqual([
      { credentialId: OTHER_CREDENTIAL_ID, rpId: APP_RP_ID },
      { credentialId: CREDENTIAL_ID, rpId: null },
    ]);
  });

  it('never accepts a passkey made for the app at the web sign-in', async () => {
    const { ownerId } = fixture();
    await seedBothRelyingParties(harness, ownerId);
    const services = passkeyServices(harness());
    services.authenticator.assertion = { newCounter: 0, userVerified: true };
    const holder = await signInBrowser(services);

    expect(
      await refusalOf(
        services.login.verify(
          { response: credential(OTHER_CREDENTIAL_ID) },
          holder.request,
          holder.response,
        ),
      ),
    ).toEqual(VERIFICATION_FAILED);
    expect(services.signIn.issued).toEqual([]);
    expect(services.authenticator.checkedAgainst).toEqual([]);
  });

  it('leaves the app passkey out of the web registration exclusion list', async () => {
    const { ownerId } = fixture();
    await seedBothRelyingParties(harness, ownerId);
    const services = passkeyServices(harness());
    const holder = browser();

    await services.registration.createOptions(
      ownerId,
      { password: PASSWORD },
      holder.request,
      holder.response,
    );

    expect(
      services.authenticator.registrationOptions.map(
        (options) => options.excludeCredentials,
      ),
    ).toEqual([[{ id: CREDENTIAL_ID, transports: ['internal'] }]]);
  });

  it('offers an app only its own passkey and never the legacy web one, and the web only the legacy one', async () => {
    const { ownerId } = fixture();
    await seedBothRelyingParties(harness, ownerId);
    // The scope native sign-in builds for its second-factor options.
    const offeredTo = async (rpId: string) =>
      (
        await harness().passkeys.listDescriptorsFor(
          ownerId,
          relyingPartyScope(rpId, WEB_RP_ID),
        )
      ).map((descriptor) => descriptor.credentialId);
    const services = passkeyServices(harness());

    await nativeRegistration(harness(), services).createOptions(
      ownerId,
      appSession('relying-party-session'),
    );

    expect(await offeredTo(APP_RP_ID)).toEqual([OTHER_CREDENTIAL_ID]);
    expect(await offeredTo(WEB_RP_ID)).toEqual([CREDENTIAL_ID]);
    expect(
      services.authenticator.registrationOptions.map((options) =>
        options.excludeCredentials.map((excluded) => excluded.id),
      ),
    ).toEqual([[OTHER_CREDENTIAL_ID]]);
  });

  it('keeps the last web passkey when the only other passkey is an app one and nothing else signs in', async () => {
    const { ownerId } = fixture();
    // With password sign-in off the stored password is no way in.
    const { management } = passkeyServices(harness(), { password: false });
    const webId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      createdAt: NOW,
    });
    const appId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: OTHER_CREDENTIAL_ID,
      createdAt: NOW,
      rpId: APP_RP_ID,
    });

    for (const passkeyId of [webId, appId]) {
      expect(await refusalOf(management.remove(ownerId, passkeyId))).toEqual(
        LAST_WAY_IN,
      );
    }
    expect(await harness().storedRelyingParties()).toEqual([
      { credentialId: OTHER_CREDENTIAL_ID, rpId: APP_RP_ID },
      { credentialId: CREDENTIAL_ID, rpId: null },
    ]);

    // A second web passkey is a way into the web, so one of the two goes.
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: THIRD_CREDENTIAL_ID,
      createdAt: NOW,
    });
    await management.remove(ownerId, webId);
    expect(await harness().storedRelyingParties()).toEqual([
      { credentialId: THIRD_CREDENTIAL_ID, rpId: null },
      { credentialId: OTHER_CREDENTIAL_ID, rpId: APP_RP_ID },
    ]);
  });

  // feature:email-code:start
  // Failure: an emailed code, which opens only apps, lets the last web passkey
  // go, or is not counted when an app passkey is removed.
  it('counts an emailed code for removing an app passkey and never for the last web one', async () => {
    const { ownerId } = fixture();
    const config = new ConfigService({
      emailCode: { enabled: true },
      auth: {
        nativeEnabled: true,
        passwordEnabled: false,
        nativeApplications: [
          { clientId: APP_CLIENT_ID, signIn: { emailCode: true } },
        ],
      },
      magicLink: { enabled: false },
      passkeys: { enabled: true, rpId: WEB_RP_ID },
    });
    const application = {
      enabled: true,
      platform: APPLICATION_PLATFORM.NATIVE,
      clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
    };
    const applications: EmailCodeApplications = {
      findClientIn: () => Promise.resolve(application),
      lookUpClient: () => Promise.resolve(application),
    };
    const grants: EmailCodeGrants = {
      takeGrantForChange: () => Promise.resolve(null),
      readGrant: () => Promise.resolve(null),
    };
    const rule = new SignInMethodRule(
      harness().signInMethods,
      new AuthFeaturesService(config, browserApplicationsForTest(config)),
      config,
      applications,
      grants,
    );
    const management = new PasskeyManagementService(
      harness().passkeys,
      rule,
      harness().runner(rerunAtOnce),
      new PasskeyConfigService(config),
      browserApplicationsForTest(config),
      noRequiredRelyingParties(),
    );
    const webId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      createdAt: NOW,
    });
    const appId = await harness().seedPasskey({
      userId: ownerId,
      credentialId: OTHER_CREDENTIAL_ID,
      createdAt: NOW,
      rpId: APP_RP_ID,
    });

    expect(await refusalOf(management.remove(ownerId, webId))).toEqual(
      LAST_WAY_IN,
    );
    expect(await harness().storedRelyingParties()).toEqual([
      { credentialId: OTHER_CREDENTIAL_ID, rpId: APP_RP_ID },
      { credentialId: CREDENTIAL_ID, rpId: null },
    ]);
    await management.remove(ownerId, appId);
    expect(await harness().storedRelyingParties()).toEqual([
      { credentialId: CREDENTIAL_ID, rpId: null },
    ]);
  });
  // feature:email-code:end
}
