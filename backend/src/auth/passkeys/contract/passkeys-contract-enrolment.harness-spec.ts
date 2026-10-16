import { HttpStatus } from '@nestjs/common';
import { rerunAtOnce } from '../../../../test/utils/session/issuance-contract/issuance-contract-support';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { EnrolmentPromotion } from '../../contracts/enrolment-promotion';
import { PasskeyRecorder } from '../services/passkey-recorder.service';
import {
  attestationOf,
  CREDENTIAL_ID,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  refusalOf,
} from './passkeys-contract.harness-spec';
import {
  APP_CLIENT_ID,
  APP_RP_ID,
  appCredential,
  appSession,
  nativeRegistration,
} from './passkeys-contract-native.harness-spec';

const SESSION = 'enrolment-session';

type PromotionInput = Parameters<
  EnrolmentPromotion['promoteAfterFirstPasskey']
>[1];

/** Sees the passkey inside the registration's unit of work, then refuses. */
class RefusingPromotion extends EnrolmentPromotion {
  readonly asked: PromotionInput[] = [];
  readonly sawPasskey: boolean[] = [];

  constructor(private readonly harness: PasskeysHarnessSource) {
    super();
  }

  async promoteAfterFirstPasskey(
    unitOfWork: UnitOfWork,
    input: PromotionInput,
  ): Promise<void> {
    this.asked.push(input);
    const inserted = await this.harness().passkeys.findByCredentialId(
      CREDENTIAL_ID,
      unitOfWork,
    );
    this.sawPasskey.push(inserted !== null);
    throw new AppException(
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
      'Invalid passkey challenge',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** The enrolment promotion joins the registration's unit of work. */
export function enrolmentCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('stores no passkey when the enrolment promotion refuses after the insert, and passes its refusal on', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    services.authenticator.attestation = attestationOf();
    const promotion = new RefusingPromotion(harness);
    const native = nativeRegistration(
      harness(),
      services,
      new PasskeyRecorder(
        harness().passkeys,
        harness().accounts,
        harness().runner(rerunAtOnce),
        promotion,
      ),
    );
    const options = await native.createOptions(ownerId, appSession(SESSION));

    const refusal = await refusalOf(
      native.verify(ownerId, appSession(SESSION), {
        response: appCredential(options.data.challenge),
      }),
    );

    expect(refusal).toEqual({ code: 'PASSKEY_CHALLENGE_INVALID', status: 401 });
    expect(promotion.sawPasskey).toEqual([true]);
    expect(promotion.asked).toEqual([
      {
        sessionId: SESSION,
        userId: ownerId,
        clientId: APP_CLIENT_ID,
        proof: {
          userId: ownerId,
          rpId: APP_RP_ID,
          credentialId: CREDENTIAL_ID,
          userVerified: true,
        },
      },
    ]);
    expect(await harness().storedPasskeys()).toEqual([]);
  });
}
