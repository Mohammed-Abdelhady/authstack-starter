import { Injectable } from '@nestjs/common';
import { AuthFeature } from '../../auth/enums/auth-feature.enum';
import { AuthFeaturesService } from '../../auth/services/features/auth-features.service';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import {
  HeldSignInMethods,
  SignInMethodStore,
} from '../stores/sign-in-method.store';

export const WAY_IN_OUTCOME = {
  ANOTHER_LEFT: 'another_way_left',
  LAST: 'last_way_in',
  NO_ACCOUNT: 'no_account',
} as const;

export type WayInOutcome = (typeof WAY_IN_OUTCOME)[keyof typeof WAY_IN_OUTCOME];

/**
 * What the deployment offers an address by itself. A method the project was
 * generated without reads as off.
 */
export interface SignInSwitches {
  /** Password sign-in, and with it password reset by email. */
  readonly password: boolean;
  readonly magicLink: boolean;
}

/** The ways in a removal accepts as left on the account once its own is gone. */
export type WaysLeft = (
  held: HeldSignInMethods,
  switches: SignInSwitches,
) => number;

/**
 * An account keeps a way to sign in. Every removal of one asks here, inside
 * the unit of work that removes it, and removes only when another is left.
 */
@Injectable()
export class SignInMethodRule {
  constructor(
    private readonly methods: SignInMethodStore,
    private readonly features: AuthFeaturesService,
  ) {}

  /**
   * Holds the account's ways in until the unit of work ends and says whether
   * the removal would leave one. Two removals on one account cannot both hold
   * them, so neither counts a way in the other is removing.
   */
  async holdForRemoval(
    unitOfWork: UnitOfWork,
    userId: string,
    waysLeft: WaysLeft,
  ): Promise<WayInOutcome> {
    return this.outcomeOf(
      await this.methods.holdForAccount(unitOfWork, userId),
      waysLeft,
    );
  }

  /**
   * What a removal would be told now, for any number of removals on one read.
   * Nothing is held, so the answer is advice for whoever offers the removal:
   * the removal itself still asks `holdForRemoval`.
   */
  async adviseOnRemoval(
    userId: string,
  ): Promise<(waysLeft: WaysLeft) => WayInOutcome> {
    const stored = await this.methods.readForAccount(userId);
    return (waysLeft) => this.outcomeOf(stored, waysLeft);
  }

  private outcomeOf(
    held: HeldSignInMethods | null,
    waysLeft: WaysLeft,
  ): WayInOutcome {
    if (!held) {
      return WAY_IN_OUTCOME.NO_ACCOUNT;
    }
    const switches: SignInSwitches = {
      password: this.features.isEnabled(AuthFeature.PASSWORD),
      magicLink: this.features.isEnabled(AuthFeature.MAGIC_LINK),
    };
    return waysLeft(held, switches) > 0
      ? WAY_IN_OUTCOME.ANOTHER_LEFT
      : WAY_IN_OUTCOME.LAST;
  }
}
