import { Injectable } from '@nestjs/common';
// feature:email-code:start
import { Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NativeApplicationConfiguration } from '../../config/types/native-application.type';
import { ApplicationAccessStore } from '../../session/applications/application-access.store';
import { ApplicationRegistry } from '../../session/applications/application-registry';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../session/constants/client-ids';
// feature:email-code:end
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
  /** Some application really lets this account in by emailed code now. */
  readonly emailCode: boolean;
  // feature:email-code:end
}

// feature:email-code:start
/** The settings that decide which applications offer sign-in by emailed code. */
export interface EmailCodeSettings {
  readonly emailCodeEnabled: boolean;
  readonly nativeEnabled: boolean;
  readonly nativeApplications: readonly NativeApplicationConfiguration[];
}

/** The applications whose configuration offers the code, none while the server or native sign-in has it off. */
export function emailCodeClientIds(settings: EmailCodeSettings): string[] {
  if (!settings.emailCodeEnabled || !settings.nativeEnabled) return [];
  return settings.nativeApplications
    .filter((application) => application.signIn?.emailCode === true)
    .map(({ clientId }) => clientId);
}

/** One application that offers the code, as the stores hold it for one account. */
export interface EmailCodeDoor {
  readonly application: {
    readonly enabled: boolean;
    readonly platform: string;
    readonly clientType: string;
  } | null;
  readonly grant: { readonly allowed: boolean } | null;
}

/**
 * The account gets in by code there: the application is stored, switched on,
 * native and public, and the account's grant to it is not blocked. No grant
 * yet is no refusal, since consent makes one.
 */
export function opensByEmailCode({
  application,
  grant,
}: EmailCodeDoor): boolean {
  return (
    application?.enabled === true &&
    application.platform === APPLICATION_PLATFORM.NATIVE &&
    application.clientType === APPLICATION_CLIENT_TYPE.PUBLIC &&
    grant?.allowed !== false
  );
}

/** The application reads the rule makes. The registry is what Nest hands it. */
export interface EmailCodeApplications {
  findClientIn(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<EmailCodeDoor['application']>;
  lookUpClient(clientId: string): Promise<EmailCodeDoor['application']>;
}

/** The grant reads the rule makes. The grant store is what Nest hands it. */
export interface EmailCodeGrants {
  takeGrantForChange(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
  ): Promise<EmailCodeDoor['grant']>;
  readGrant(userId: string, clientId: string): Promise<EmailCodeDoor['grant']>;
}

/** The config keys `AuthEpochService` reads, with its defaults. */
function emailCodeSettingsOf(config: ConfigService): EmailCodeSettings {
  return {
    emailCodeEnabled: config.get<boolean>('emailCode.enabled', false) === true,
    nativeEnabled: config.get<boolean>('auth.nativeEnabled', false) === true,
    nativeApplications: config.get<NativeApplicationConfiguration[]>(
      'auth.nativeApplications',
      [],
    ),
  };
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

function outcomeOf(
  held: HeldSignInMethods,
  waysLeft: WaysLeft,
  switches: SignInSwitches,
): WayInOutcome {
  return waysLeft(held, switches) > 0
    ? WAY_IN_OUTCOME.ANOTHER_LEFT
    : WAY_IN_OUTCOME.LAST;
}

/**
 * An account keeps a way to sign in. Every removal of one asks here, inside
 * the unit of work that removes it, and removes only when another is left.
 */
@Injectable()
export class SignInMethodRule {
  constructor(
    private readonly methods: SignInMethodStore,
    private readonly features: AuthFeaturesService,
    // feature:email-code:start
    @Optional() private readonly config?: ConfigService,
    @Optional()
    @Inject(ApplicationRegistry)
    private readonly applications?: EmailCodeApplications,
    @Optional()
    @Inject(ApplicationAccessStore)
    private readonly grants?: EmailCodeGrants,
    // feature:email-code:end
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
    const held = await this.methods.holdForAccount(unitOfWork, userId);
    if (!held) return WAY_IN_OUTCOME.NO_ACCOUNT;
    return outcomeOf(held, waysLeft, {
      ...this.switchedOn(),
      emailCode: await this.emailCodeOpens(userId, unitOfWork), // feature:email-code
    });
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
    if (!stored) return () => WAY_IN_OUTCOME.NO_ACCOUNT;
    const switches: SignInSwitches = {
      ...this.switchedOn(),
      emailCode: await this.emailCodeOpens(userId), // feature:email-code
    };
    return (waysLeft) => outcomeOf(stored, waysLeft, switches);
  }

  /** The methods the deployment switches on for every account alike. */
  private switchedOn(): Pick<SignInSwitches, 'password' | 'magicLink'> {
    return {
      password: this.features.isEnabled(AuthFeature.PASSWORD),
      magicLink: this.features.isEnabled(AuthFeature.MAGIC_LINK),
    };
  }

  // feature:email-code:start
  /**
   * Whether some application the configuration offers the code on lets this
   * account in now. A removal reads each one in its own unit of work, after
   * the account's ways in are held, and advice reads them committed. With no
   * configuration or no readers wired, the code is no way in.
   */
  private async emailCodeOpens(
    userId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<boolean> {
    const { config, applications, grants } = this;
    if (!config || !applications || !grants) return false;
    for (const clientId of emailCodeClientIds(emailCodeSettingsOf(config))) {
      const door: EmailCodeDoor = unitOfWork
        ? {
            application: await applications.findClientIn(unitOfWork, clientId),
            grant: await grants.takeGrantForChange(
              unitOfWork,
              userId,
              clientId,
            ),
          }
        : {
            application: await applications.lookUpClient(clientId),
            grant: await grants.readGrant(userId, clientId),
          };
      if (opensByEmailCode(door)) return true;
    }
    return false;
  }
  // feature:email-code:end
}
