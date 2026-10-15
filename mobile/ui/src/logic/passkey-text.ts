import type { PasskeyRegisterOutcome } from '@app/native-auth';
import type { PasskeySummary } from '@app/sdk';
import { NOTICE_TONE, type NoticeTone } from '../components/Notice';
import type { Locale, MessageKey, Translate } from '../i18n';
import { isolateTyped } from './isolate';

export interface PasskeyNotice {
  tone: NoticeTone;
  title: string;
  description: string;
  /** The person has to sign in again before trying once more. */
  signInAgain?: boolean;
}

type Outcome = PasskeyRegisterOutcome['kind'];

const OUTCOME_TEXT: Record<Outcome, { title: MessageKey; description: MessageKey }> = {
  created: { title: 'passkeys.created.title', description: 'passkeys.created.description' },
  cancelled: { title: 'passkeys.cancelled.title', description: 'passkeys.cancelled.description' },
  notSupported: {
    title: 'passkeys.notSupported.title',
    description: 'passkeys.notSupported.description',
  },
  signInAgain: {
    title: 'passkeys.signInAgain.title',
    description: 'passkeys.signInAgain.description',
  },
  alreadyRegistered: {
    title: 'passkeys.alreadyRegistered.title',
    description: 'passkeys.alreadyRegistered.description',
  },
  failed: { title: 'passkeys.failed.title', description: 'passkeys.failed.description' },
};

/**
 * A passkey's name, read in its own direction inside a line of either. An older
 * rename could store a blank one, which reads as the app's own word for it.
 */
export function passkeyName(t: Translate, passkey: PasskeySummary): string {
  if (passkey.name.trim().length === 0) return t('passkeys.unnamed');
  return isolateTyped(passkey.name);
}

export function outcomeNotice(t: Translate, outcome: PasskeyRegisterOutcome): PasskeyNotice {
  const text = OUTCOME_TEXT[outcome.kind];
  const name = outcome.kind === 'created' ? passkeyName(t, outcome.passkey) : '';
  return {
    tone: outcome.kind === 'created' ? NOTICE_TONE.INFO : NOTICE_TONE.PROBLEM,
    title: t(text.title),
    description: t(text.description, { name }),
    ...(outcome.kind === 'signInAgain' ? { signInAgain: true } : {}),
  };
}

function dateText(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium' }).format(
    new Date(iso),
  );
}

/** When it was added, and when it last signed in. */
export function passkeyDates(t: Translate, locale: Locale, passkey: PasskeySummary): string[] {
  return [
    t('passkeys.addedOn', { date: dateText(locale, passkey.createdAt) }),
    passkey.lastUsedAt === null
      ? t('passkeys.neverUsed')
      : t('passkeys.lastUsed', { date: dateText(locale, passkey.lastUsedAt) }),
  ];
}
