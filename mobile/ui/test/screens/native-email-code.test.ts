import { act } from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportRequest } from '@app/sdk';
import {
  apiReply,
  failedApiReply,
  oauthTokenReply,
  successUserReply,
} from '../../../auth/test/support/support';
import {
  nativeApp,
  disposeNativeApps,
  ATTEMPT_ID,
  ATTEMPT_SECRET,
  METHODS,
} from '../support/native-auth';
import { byRole, cleanup, flush, textsOf } from '../support/render';
import { HOST } from '../support/react-native';
import { translate, type Locale, type MessageKey } from '../../src/i18n';
import { LOCALES } from '../support/locales';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

const CODE_METHODS = { ...METHODS, capabilities: { ...METHODS.capabilities, emailCode: true } };
const EMAIL = 'person@example.test';
const RIGHT_CODE = '482913';
const WRONG_CODE = '482914';
/** The right code in another script's digits, U+0660 to U+0669, as some keyboards type it. */
const RIGHT_CODE_OTHER_DIGITS = String.fromCodePoint(
  ...[...RIGHT_CODE].map((digit) => 0x0660 + Number.parseInt(digit, 10)),
);
const ATTEMPT_PATH = `/api/auth/native/attempts/${ATTEMPT_ID}`;

type App = Awaited<ReturnType<typeof nativeApp>>;

function buttons(root: ReactTestInstance, locale: Locale, name: MessageKey) {
  return byRole(root, 'button').filter(
    (node) => node.props.accessibilityLabel === translate(locale, name),
  );
}

function fields(root: ReactTestInstance, locale: Locale, name: MessageKey) {
  return root.findAll(
    (node) =>
      node.type === HOST.TEXT_INPUT && node.props.accessibilityLabel === translate(locale, name),
  );
}

async function pressButton(app: App, locale: Locale, name: MessageKey): Promise<void> {
  const [target, ...others] = buttons(app.root, locale, name);
  if (target === undefined || others.length > 0) throw new Error(`Expected one ${name} button`);
  const onPress = target.props.onPress;
  if (target.props.disabled !== true && typeof onPress === 'function') act(() => onPress());
  await flush();
}

async function typeInto(app: App, locale: Locale, name: MessageKey, value: string): Promise<void> {
  const [target] = fields(app.root, locale, name);
  const change = target?.props.onChangeText;
  if (typeof change !== 'function') throw new Error(`No ${name} field`);
  act(() => change(value));
  await flush();
}

const alerts = (app: App) => byRole(app.root, 'alert').flatMap(textsOf);
const bodiesTo = (app: App, path: string) =>
  app.transport.sent.filter((request) => request.path === path).map(({ body }) => body);
const codeOf = ({ body }: TransportRequest): unknown =>
  typeof body === 'object' && body !== null ? Reflect.get(body, 'code') : undefined;

/** The server's side of one code journey: a code is mailed, and `verify` answers each guess. */
function serveCodeJourney(app: App, verify: (request: TransportRequest) => Promise<unknown>) {
  const waiting = {
    attemptId: ATTEMPT_ID,
    stage: 'emailLinkSent',
    expiresAt: app.expiresAt,
    email: EMAIL,
  };
  app.raw('/api/auth/native/attempts', async () =>
    apiReply({
      attemptId: ATTEMPT_ID,
      attemptSecret: ATTEMPT_SECRET,
      providerNonceDigest: 'a'.repeat(64),
      stage: 'firstFactorRequired',
      expiresAt: app.expiresAt,
      factors: ['emailCode'],
    }),
  );
  app.reply('email-code/request', waiting);
  app.raw(ATTEMPT_PATH, async () => apiReply(waiting));
  app.raw(`${ATTEMPT_PATH}/email-code/verify`, async (request) => {
    const answer = await verify(request);
    return answer === undefined ? failedApiReply(400, 'EMAIL_CODE_INVALID') : apiReply(answer);
  });
}

async function askForCode(app: App, locale: Locale): Promise<void> {
  await pressButton(app, locale, 'native.emailCodeChoice');
  await typeInto(app, locale, 'native.email', EMAIL);
  await pressButton(app, locale, 'native.sendSignInCode');
}

describe.each(LOCALES)('native sign-in by emailed code in %s', (locale) => {
  it('offers the code choice only when the server does, in place of the link choice', async () => {
    const linkOnly = await nativeApp(locale);
    const withCode = await nativeApp(locale, { methods: CODE_METHODS });

    expect([
      buttons(linkOnly.root, locale, 'native.emailCodeChoice').length,
      buttons(linkOnly.root, locale, 'native.emailLinkChoice').length,
      buttons(withCode.root, locale, 'native.emailCodeChoice').length,
      buttons(withCode.root, locale, 'native.emailLinkChoice').length,
    ]).toEqual([0, 1, 1, 0]);
  });

  it('keeps the code stage across a restart, refuses a wrong code and signs in with the right one', async () => {
    const app = await nativeApp(locale, { methods: CODE_METHODS });
    serveCodeJourney(app, async (request) => {
      if (codeOf(request) !== RIGHT_CODE) return undefined;
      const record = JSON.parse(app.ports.credentials.value ?? '{}') as {
        transaction?: { state?: string };
      };
      return {
        attemptId: ATTEMPT_ID,
        stage: 'codeReady',
        expiresAt: app.expiresAt,
        redirectUri: `sampleapp://auth/callback?code=issued-code&state=${record.transaction?.state ?? ''}`,
      };
    });
    app.raw('/api/oauth/token', async () => oauthTokenReply());
    app.raw('/api/user/profile', async () => successUserReply());

    await askForCode(app, locale);
    await app.remount();
    await pressButton(app, locale, 'native.resend');
    await typeInto(app, locale, 'native.emailCode', WRONG_CODE);
    await pressButton(app, locale, 'native.verify');
    const refusal = alerts(app);
    const fieldAfterRefusal = fields(app.root, locale, 'native.emailCode')[0]?.props.value;
    await typeInto(app, locale, 'native.emailCode', RIGHT_CODE_OTHER_DIGITS);
    await pressButton(app, locale, 'native.verify');

    expect(bodiesTo(app, `${ATTEMPT_PATH}/email-code/request`)).toEqual([
      { email: EMAIL, locale },
      { email: EMAIL, locale },
    ]);
    expect(bodiesTo(app, '/api/auth/native/attempts')).toHaveLength(1);
    expect(refusal).toContain(translate(locale, 'native.codeRefused'));
    expect(fieldAfterRefusal).toBe('');
    expect(bodiesTo(app, `${ATTEMPT_PATH}/email-code/verify`)).toEqual([
      { code: WRONG_CODE, locale },
      { code: RIGHT_CODE, locale },
    ]);
    expect(app.engine.snapshot.status).toBe('signedIn');
  });

  it('offers no link-only resend while the methods reply fails after a restart, and gets the code screen back on retry', async () => {
    const app = await nativeApp(locale, { methods: CODE_METHODS });
    serveCodeJourney(app, async () => undefined);
    await askForCode(app, locale);
    app.failMethods(true);
    await app.remount();
    const resendsWithoutMethods = buttons(app.root, locale, 'native.resend').length;

    app.failMethods(false);
    await pressButton(app, locale, 'common.tryAgain');
    await typeInto(app, locale, 'native.emailCode', RIGHT_CODE);
    await pressButton(app, locale, 'native.verify');

    expect(resendsWithoutMethods).toBe(0);
    expect(bodiesTo(app, `${ATTEMPT_PATH}/email-code/verify`)).toEqual([
      { code: RIGHT_CODE, locale },
    ]);
  });

  it('ends the journey when the server ends the attempt after a refused code', async () => {
    const app = await nativeApp(locale, { methods: CODE_METHODS });
    serveCodeJourney(app, async () => undefined);
    await askForCode(app, locale);
    app.raw(ATTEMPT_PATH, async () =>
      apiReply({ attemptId: ATTEMPT_ID, stage: 'denied', expiresAt: app.expiresAt }),
    );

    await typeInto(app, locale, 'native.emailCode', WRONG_CODE);
    await pressButton(app, locale, 'native.verify');

    expect(alerts(app)).toContain(translate(locale, 'native.codeAttemptEnded'));
    expect(fields(app.root, locale, 'native.emailCode')).toHaveLength(0);
    expect(buttons(app.root, locale, 'common.tryAgain')).toHaveLength(1);
    expect(app.ports.credentials.value).toBeUndefined();
  });
});
