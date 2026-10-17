import type { AbstractIntlMessages } from 'next-intl';
import { routing } from './routing';

export type AppLocale = (typeof routing.locales)[number];

const APP_LOCALES: readonly string[] = routing.locales;

export function isAppLocale(value: string | undefined): value is AppLocale {
  return value !== undefined && APP_LOCALES.includes(value);
}

function isMessageTree(value: unknown): value is AbstractIntlMessages {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mergeMessageTrees(
  base: AbstractIntlMessages,
  overlay: AbstractIntlMessages,
): AbstractIntlMessages {
  const merged: AbstractIntlMessages = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    if (isMessageTree(value) && isMessageTree(existing)) {
      merged[key] = mergeMessageTrees(existing, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

export async function loadMessages(locale: AppLocale): Promise<AbstractIntlMessages> {
  const common = (await import(`./messages/${locale}.json`)).default;
  const topics = await Promise.all(
    [
      'pagination',
      'home',
      'nav',
      'auth',
      'toast',
      'settings',
      'errors',
      'dashboard',
      'sessions',
      'users',
      'roles',
      'permissions',
      'validation',
    ].map(async (topic) => (await import(`./messages/${topic}.${locale}.json`)).default),
  );
  topics.push(
    ...(await Promise.all([
      import(`../modules/admin-sessions/messages/${locale}.json`).then((module) => module.default),
      import(`../modules/activity/messages/${locale}.json`).then((module) => module.default),
      import(`../modules/account/email-change/messages/${locale}.json`).then(
        (module) => module.default,
      ),
      import(`../modules/account/deletion/messages/${locale}.json`).then(
        (module) => module.default,
      ),
    ])),
  );
  topics.push((await import(`../modules/invitations/messages/${locale}.json`)).default); // feature:invitations
  const base = topics.reduce<AbstractIntlMessages>((messages, topic: unknown) => {
    if (!isMessageTree(topic)) throw new Error(`Locale messages for ${locale} are not objects`);
    return mergeMessageTrees(messages, topic);
  }, common);
  const sessionAuthority = (await import(`./messages/session-authority.${locale}.json`)).default;
  const browserProof = (await import(`./messages/browser-proof.${locale}.json`)).default;
  const nativeAuth = (await import(`./messages/native-auth.${locale}.json`)).default;
  const statusErrors = (await import(`./messages/status-errors.${locale}.json`)).default;
  const roleErrors = (await import(`./messages/role-errors.${locale}.json`)).default;
  const sessionKinds = (await import(`./messages/session-kinds.${locale}.json`)).default;
  const codeVerification = (await import(`./messages/code-verification.${locale}.json`)).default;
  const adminEmailConfirmation = (
    await import(`./messages/admin-email-confirmation.${locale}.json`)
  ).default;
  const adminUsers = (await import(`./messages/admin-users.${locale}.json`)).default;
  const profileSettings = (await import(`./messages/profile-settings.${locale}.json`)).default;
  if (
    !isMessageTree(base) ||
    !isMessageTree(sessionAuthority) ||
    !isMessageTree(browserProof) ||
    !isMessageTree(nativeAuth) ||
    !isMessageTree(statusErrors) ||
    !isMessageTree(roleErrors) ||
    !isMessageTree(sessionKinds) ||
    !isMessageTree(codeVerification) ||
    !isMessageTree(adminEmailConfirmation) ||
    !isMessageTree(adminUsers) ||
    !isMessageTree(profileSettings)
  ) {
    throw new Error(`Locale messages for ${locale} are not objects`);
  }
  return mergeMessageTrees(
    mergeMessageTrees(
      mergeMessageTrees(
        mergeMessageTrees(
          mergeMessageTrees(
            mergeMessageTrees(mergeMessageTrees(base, sessionAuthority), browserProof),
            nativeAuth,
          ),
          statusErrors,
        ),
        roleErrors,
      ),
      sessionKinds,
    ),
    mergeMessageTrees(
      mergeMessageTrees(mergeMessageTrees(codeVerification, adminEmailConfirmation), adminUsers),
      profileSettings,
    ),
  );
}
