import { validateEnvironment } from '../../config/env.validation';
import { parseMailLinkTemplates } from './mail-link-templates';

const BASE_ENV: Record<string, unknown> = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'http://localhost:3000',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
};

const EVERY_MAIL = {
  emailChangeCode: 'https://id.example.test',
  magicLink: 'https://id.example.test/{locale}/link?app=customer',
};

function startWith(setting: string, value: unknown): string {
  try {
    validateEnvironment({ ...BASE_ENV, [setting]: value });
    return 'started';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('mail link settings at start-up', () => {
  it.each(['MAIL_LINKS_CUSTOMER', 'MAIL_LINKS_STAFF'])(
    'starts with %s absent, blank, or naming every mail with a link',
    (setting) => {
      expect([
        startWith(setting, undefined),
        startWith(setting, '  '),
        startWith(setting, JSON.stringify(EVERY_MAIL)),
      ]).toEqual(['started', 'started', 'started']);
    },
  );

  it.each([
    {
      problem: 'a mail that does not exist',
      value: { ...EVERY_MAIL, passwordReset: 'https://id.example.test' },
      message:
        'MAIL_LINKS_CUSTOMER names "passwordReset", which is not a mail with a link. Mails with a link: emailChangeCode, magicLink',
    },
    {
      problem: 'a mail left out',
      value: { emailChangeCode: 'https://id.example.test' },
      message:
        'MAIL_LINKS_CUSTOMER has no template for "magicLink". Set every one of: emailChangeCode, magicLink',
    },
    {
      problem: 'a relative template',
      value: { ...EVERY_MAIL, magicLink: '/sign-in/link' },
      message: 'MAIL_LINKS_CUSTOMER.magicLink must be an absolute URL',
    },
    {
      problem: 'another scheme',
      value: { ...EVERY_MAIL, magicLink: 'ftp://id.example.test' },
      message:
        'MAIL_LINKS_CUSTOMER.magicLink must start with https:// or http://',
    },
    {
      problem: 'a fragment',
      value: { ...EVERY_MAIL, magicLink: 'https://id.example.test/#/link' },
      message: 'MAIL_LINKS_CUSTOMER.magicLink must not carry a fragment',
    },
    {
      problem: 'a placeholder other than {locale}',
      value: { ...EVERY_MAIL, magicLink: 'https://id.example.test/{lang}' },
      message:
        'MAIL_LINKS_CUSTOMER.magicLink may hold no placeholder but {locale}',
    },
    {
      problem: 'a template that is not text',
      value: { ...EVERY_MAIL, magicLink: 7 },
      message: 'MAIL_LINKS_CUSTOMER.magicLink must be a URL in a string',
    },
  ])('refuses to start on $problem', ({ value, message }) => {
    const answer = startWith('MAIL_LINKS_CUSTOMER', JSON.stringify(value));

    expect(answer).toContain(`- MAIL_LINKS_CUSTOMER: ${message}`);
  });

  it.each([
    ['text that is not JSON', '{emailChangeCode:'],
    ['a JSON list', JSON.stringify([EVERY_MAIL])],
    ['a JSON string', JSON.stringify('https://id.example.test')],
  ])('refuses to start on %s', (_problem, value) => {
    expect(startWith('MAIL_LINKS_STAFF', value)).toContain(
      '- MAIL_LINKS_STAFF: MAIL_LINKS_STAFF must be a JSON object keyed by mail name',
    );
  });

  it('refuses the same setting when the configuration reads it', () => {
    expect(() =>
      parseMailLinkTemplates(
        JSON.stringify({ ...EVERY_MAIL, signIn: 'https://id.example.test' }),
        'MAIL_LINKS_STAFF',
      ),
    ).toThrow('MAIL_LINKS_STAFF names "signIn"');
  });
});
