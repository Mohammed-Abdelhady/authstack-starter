import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { SecurityNoticeService } from '../../../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../../../user/constants/security-notice.constants';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import {
  SignInMethodRule,
  SignInSwitches,
  WAY_IN_OUTCOME,
  WayInOutcome,
  WaysLeft,
} from '../../../user/services/sign-in-method.rule';
import { HeldSignInMethods } from '../../../user/stores/sign-in-method.store';
import {
  PasskeyListResponseDto,
  PasskeySummaryDto,
} from '../dto/passkey-summary.dto';
import { RenamePasskeyDto } from '../dto/rename-passkey.dto';
import { toPasskeySummary } from '../utils/passkey-summary.util';
import { PasskeyStore, StoredPasskey } from '../stores/passkey.store';
import { relyingPartyOf, relyingPartyScope } from '../utils/relying-party.util';
import { PasskeyConfigService } from './passkey-config.service';

/** A stored password while password sign-in is on, linked providers, magic links. */
function waysInBesidesPasskeys(
  held: HeldSignInMethods,
  switches: SignInSwitches,
): number {
  return (
    (switches.password && held.hasPassword ? 1 : 0) +
    held.linkedProviders.length +
    (switches.magicLink ? 1 : 0)
  );
}

/**
 * What a passkey removal accepts as left: another passkey, a stored password
 * while password sign-in is on, a linked provider, and magic links.
 */
const waysLeftWithoutOnePasskey: WaysLeft = (held, switches) =>
  held.passkeys - 1 + waysInBesidesPasskeys(held, switches);

/** Only the last way in stays. The passkey of an account that is gone goes. */
function refusesRemoval(wayIn: WayInOutcome): boolean {
  return wayIn === WAY_IN_OUTCOME.LAST;
}

/**
 * The passkeys on an account, from the account settings. Every lookup is
 * scoped to the signed-in user, so an id belonging to someone else reads as
 * absent rather than as forbidden.
 */
@Injectable()
export class PasskeyManagementService {
  private readonly logger = new Logger(PasskeyManagementService.name);

  constructor(
    private readonly passkeys: PasskeyStore,
    private readonly signInMethods: SignInMethodRule,
    private readonly runner: UnitOfWorkRunner,
    private readonly config: PasskeyConfigService,
    private readonly notices?: SecurityNoticeService,
  ) {}

  async list(userId: string): Promise<ApiResponse<PasskeyListResponseDto>> {
    const [passkeys, advise] = await Promise.all([
      this.passkeys.listForAccount(userId),
      this.signInMethods.adviseOnRemoval(userId),
    ]);

    return ApiResponse.success({
      passkeys: passkeys.map(toPasskeySummary),
      // The answer `remove` would get from the same rule, with nothing held.
      canRemove: !refusesRemoval(advise(waysLeftWithoutOnePasskey)),
    });
  }

  /** @throws AppException PASSKEY_NOT_FOUND when the account has no such passkey */
  async rename(
    userId: string,
    passkeyId: string,
    dto: RenamePasskeyDto,
  ): Promise<ApiResponse<PasskeySummaryDto>> {
    const passkey = await this.findOwned(userId, passkeyId);
    const renamed = await this.passkeys.rename(passkey, dto.name.trim());

    return ApiResponse.success(toPasskeySummary(renamed), 'Passkey renamed');
  }

  /**
   * @throws AppException PASSKEY_NOT_FOUND when the account has no such passkey
   * @throws AppException PASSKEY_LAST_SIGN_IN_METHOD when removing it would
   * lock the account out, or leave its relying party with no passkey and the
   * account with no other way in
   */
  async remove(
    userId: string,
    passkeyId: string,
  ): Promise<ApiResponse<{ message: string }>> {
    const passkey = await this.findOwned(userId, passkeyId);
    // The count and the removal commit or abort together, so two removals at
    // once cannot each count the other's passkey as the one that stays.
    await this.runner.run(async (unitOfWork) => {
      // The rule reads the account's ways in under its hold; the ones that
      // are not passkeys are kept for the relying-party count below.
      const besides: { ways?: number } = {};
      const wayIn = await this.signInMethods.holdForRemoval(
        unitOfWork,
        userId,
        (held, switches) => {
          besides.ways = waysInBesidesPasskeys(held, switches);
          return waysLeftWithoutOnePasskey(held, switches);
        },
      );
      // A removal of the same passkey may have finished while this one waited
      // for the hold. It is gone then, and the count no longer includes it.
      await this.findOwned(userId, passkeyId, unitOfWork);
      this.assertNotTheLastWayIn(wayIn);
      if (besides.ways !== undefined) {
        await this.assertRelyingPartyKeepsAWayIn(
          unitOfWork,
          passkey,
          besides.ways,
        );
      }
      await this.passkeys.remove(unitOfWork, passkey);
    });

    this.logger.log(`Passkey removed for user ${userId}`);
    this.notices?.defer(userId, SECURITY_NOTICE.PASSKEY_REMOVED);
    return ApiResponse.success({ message: 'Passkey removed' });
  }

  /**
   * A passkey of one relying party does not sign in to another, so the last
   * passkey of a relying party stays unless the account has another way in.
   * Counted under the rule's hold, in the removal's unit of work.
   */
  private async assertRelyingPartyKeepsAWayIn(
    unitOfWork: UnitOfWork,
    passkey: StoredPasskey,
    waysBesidesPasskeys: number,
  ): Promise<void> {
    const webRpId = this.config.rpId;
    const samePartyPasskeys = await this.passkeys.countForRelyingParty(
      passkey.userId,
      relyingPartyScope(relyingPartyOf(passkey, webRpId), webRpId),
      unitOfWork,
    );
    this.assertNotTheLastWayIn(
      samePartyPasskeys - 1 + waysBesidesPasskeys > 0
        ? WAY_IN_OUTCOME.ANOTHER_LEFT
        : WAY_IN_OUTCOME.LAST,
    );
  }

  private async findOwned(
    userId: string,
    passkeyId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<StoredPasskey> {
    const passkey = await this.passkeys.findOwned(
      userId,
      passkeyId,
      unitOfWork,
    );

    if (!passkey) {
      throw new AppException(
        ErrorCode.PASSKEY_NOT_FOUND,
        'Passkey not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return passkey;
  }

  /**
   * The last passkey stays when it is the only way into the account: no second
   * passkey, no password to sign in with, no linked OAuth account, and no
   * magic link. Any one of those, and the passkey goes. So does the passkey
   * of an account that is gone: nobody can be locked out of it.
   */
  private assertNotTheLastWayIn(wayIn: WayInOutcome): void {
    if (!refusesRemoval(wayIn)) {
      return;
    }

    throw new AppException(
      ErrorCode.PASSKEY_LAST_SIGN_IN_METHOD,
      'This is the only way to sign in to the account. Add a password or ' +
        'another passkey first.',
      HttpStatus.CONFLICT,
    );
  }
}
