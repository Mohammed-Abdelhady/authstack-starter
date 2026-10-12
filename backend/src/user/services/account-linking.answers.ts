import { EMAIL_PROVIDER } from '../../common/constants/oauth-providers';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  EMAIL_SIGN_IN,
  EmailSignInHint,
  PRIMARY_HINT,
  PrimaryHint,
  UNLINK_HINT,
  UnlinkHint,
} from '../dto/account-linking.dto';
import { WAY_IN_OUTCOME, WayInOutcome, WaysLeft } from './sign-in-method.rule';

/**
 * Asked of the rule: is email sign-in a way into this account now. It is on
 * an account created for it while the deployment can sign that address in or
 * recover it, by password reset or by magic link.
 */
export const emailWayIn: WaysLeft = (held, switches) =>
  held.emailSignIn && (switches.password || switches.magicLink) ? 1 : 0;

/** What the rule's answer about `emailWayIn` means for the email row. */
export function emailSignInAnswer(wayIn: WayInOutcome): EmailSignInHint {
  return wayIn === WAY_IN_OUTCOME.ANOTHER_LEFT
    ? EMAIL_SIGN_IN.USABLE
    : EMAIL_SIGN_IN.SWITCHED_OFF;
}

/**
 * What an unlink accepts as left: every other linked provider, and email
 * sign-in while it is a way in.
 */
export function waysLeftWithout(provider: string): WaysLeft {
  return (held, switches) => {
    const others = held.linkedProviders.filter((linked) => linked !== provider);

    return emailWayIn(held, switches) + others.length;
  };
}

export const NOT_LINKED = 'not_linked';

/**
 * The one answer to "may this provider be unlinked", for the unlink and for
 * the hint a page reads. Email is never a link, a provider has to be linked,
 * and the last way in stays.
 */
export function unlinkAnswer(
  provider: string,
  linkedProviders: string[],
  wayIn: WayInOutcome,
): UnlinkHint | typeof NOT_LINKED {
  if (provider === EMAIL_PROVIDER) {
    return UNLINK_HINT.NOT_REMOVABLE;
  }
  if (!linkedProviders.includes(provider)) {
    return NOT_LINKED;
  }
  return wayIn === WAY_IN_OUTCOME.ANOTHER_LEFT
    ? UNLINK_HINT.ALLOWED
    : UNLINK_HINT.LAST_SIGN_IN_METHOD;
}

/** How an unlink refuses each answer but the allowed one. */
export const UNLINK_REFUSAL: Record<
  Exclude<ReturnType<typeof unlinkAnswer>, typeof UNLINK_HINT.ALLOWED>,
  { code: ErrorCode; message: (provider: string) => string }
> = {
  [UNLINK_HINT.NOT_REMOVABLE]: {
    code: ErrorCode.VALIDATION_ERROR,
    message: () => 'Email sign-in cannot be unlinked',
  },
  [NOT_LINKED]: {
    code: ErrorCode.PROVIDER_NOT_LINKED,
    message: (provider) => `${provider} is not linked to your account`,
  },
  [UNLINK_HINT.LAST_SIGN_IN_METHOD]: {
    code: ErrorCode.CANNOT_UNLINK_LAST_PROVIDER,
    message: () => 'You must keep at least one sign-in method',
  },
};

/**
 * The one answer to "may this provider be the primary", for the choice and
 * for the hint a page reads. Only a linked provider has a profile to follow.
 */
export function primaryAnswer(
  provider: string,
  linkedProviders: string[],
): PrimaryHint | typeof NOT_LINKED {
  if (provider === EMAIL_PROVIDER) {
    return PRIMARY_HINT.NO_PROFILE_TO_SYNC;
  }
  return linkedProviders.includes(provider) ? PRIMARY_HINT.ALLOWED : NOT_LINKED;
}

/** How choosing a primary refuses each answer but the allowed one. */
export const PRIMARY_REFUSAL: Record<
  Exclude<ReturnType<typeof primaryAnswer>, typeof PRIMARY_HINT.ALLOWED>,
  { code: ErrorCode; message: (provider: string) => string }
> = {
  [PRIMARY_HINT.NO_PROFILE_TO_SYNC]: {
    code: ErrorCode.VALIDATION_ERROR,
    message: () => 'Email sign-in has no profile to sync',
  },
  [NOT_LINKED]: UNLINK_REFUSAL[NOT_LINKED],
};
