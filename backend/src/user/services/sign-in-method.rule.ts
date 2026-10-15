import { Injectable } from '@nestjs/common';
import { Optional } from '@nestjs/common'; // feature:email-code
import { ConfigService } from '@nestjs/config'; // feature:email-code
import type { NativeApplicationConfiguration } from '../../config/types/native-application.type'; // feature:email-code
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
  // feature:email-code:start
  /** Someone can sign in by emailed code: see `emailCodeOffered`. */
  readonly emailCode: boolean;
  // feature:email-code:end
}

// feature:email-code:start
/** The settings that decide whether anyone can sign in by emailed code. */
export interface EmailCodeSettings {
  readonly emailCodeEnabled: boolean;
  readonly nativeEnabled: boolean;
  readonly nativeApplications: readonly NativeApplicationConfiguration[];
}

/** A way in only while the server, native sign-in and some application all offer it. */
export function emailCodeOffered(settings: EmailCodeSettings): boolean {
  return (
    settings.emailCodeEnabled &&
    settings.nativeEnabled &&
    settings.nativeApplications.some(
      (application) => application.signIn?.emailCode === true,
    )
  );
}
// feature:email-code:end

export const WAY_IN_SURFACE = {
  ANY: 'any',
  BROWSER: 'browser',
  NATIVE: 'native',
} as const;

export type WayInSurface = (typeof WAY_IN_SURFACE)[keyof typeof WAY_IN_SURFACE];

const EVERY_SURFACE: readonly WayInSurface[] = Object.values(WAY_IN_SURFACE);

interface WayInCount {
  readonly surfaces: readonly WayInSurface[];
  readonly count: (held: HeldSignInMethods, switches: SignInSwitches) => number;
}

const WAYS_IN_BESIDES_PASSKEYS: readonly WayInCount[] = [
  {
    surfaces: EVERY_SURFACE,
    count: (held, switches) => (switches.password && held.hasPassword ? 1 : 0),
  },
  { surfaces: EVERY_SURFACE, count: (held) => held.linkedProviders.length },
  {
    surfaces: EVERY_SURFACE,
    count: (_held, switches) => (switches.magicLink ? 1 : 0),
  },
  // feature:email-code:start
  {
    surfaces: [WAY_IN_SURFACE.ANY, WAY_IN_SURFACE.NATIVE],
    count: (_held, switches) => (switches.emailCode ? 1 : 0),
  },
  // feature:email-code:end
];

/** Password, providers and magic link count on every surface today, so a later change to any of them goes through the surface too. */
export function waysInBesidesPasskeys(
  held: HeldSignInMethods,
  switches: SignInSwitches,
  surface: WayInSurface,
): number {
  return WAYS_IN_BESIDES_PASSKEYS.filter(({ surfaces }) =>
    surfaces.includes(surface),
  ).reduce((ways, { count }) => ways + count(held, switches), 0);
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
    @Optional() private readonly config?: ConfigService, // feature:email-code
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
      emailCode: this.emailCodeOffered(), // feature:email-code
    };
    return waysLeft(held, switches) > 0
      ? WAY_IN_OUTCOME.ANOTHER_LEFT
      : WAY_IN_OUTCOME.LAST;
  }

  // feature:email-code:start
  /** The config keys `AuthEpochService` reads, with its defaults. Absent config offers nothing. */
  private emailCodeOffered(): boolean {
    if (!this.config) return false;
    return emailCodeOffered({
      emailCodeEnabled:
        this.config.get<boolean>('emailCode.enabled', false) === true,
      nativeEnabled: this.config.get<boolean>('auth.nativeEnabled', false),
      nativeApplications: this.config.get<NativeApplicationConfiguration[]>(
        'auth.nativeApplications',
        [],
      ),
    });
  }
  // feature:email-code:end
}
