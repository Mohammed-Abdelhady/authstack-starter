import { ConfigService } from '@nestjs/config';
import { storedLocale } from '../../common/constants/locales';
import configuration from '../../config/configuration';
import { MAIL_NAME } from '../constants/mail-names';
import type { MailRecipient } from '../types/mail-recipient.types';
import {
  MAIL_AUDIENCE,
  MailAudience,
  mailLink,
  mailLinkFor,
} from './mail-links';

const SETTINGS = ['CLIENT_URL', 'MAIL_LINKS_CUSTOMER', 'MAIL_LINKS_STAFF'];
const ENGLISH = { email: 'user@example.test', locale: 'en' } as const;
const TOKEN = { token: 'abc' };

/** The configuration a server reading these settings would start with. */
function configured(settings: Record<string, string>): ConfigService {
  for (const name of SETTINGS) delete process.env[name];
  Object.assign(process.env, settings);
  return new ConfigService(configuration());
}

function linksOf(config: ConfigService, recipient: MailRecipient = ENGLISH) {
  return {
    emailChange: mailLink(config, MAIL_NAME.EMAIL_CHANGE_CODE, recipient),
    magicLink: mailLink(config, MAIL_NAME.MAGIC_LINK, recipient, TOKEN),
  };
}

describe('mail links', () => {
  const previous = Object.fromEntries(
    SETTINGS.map((name) => [name, process.env[name]]),
  );

  afterAll(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it.each([
    {
      clientUrl: 'http://localhost:3000',
      emailChange: 'http://localhost:3000/auth/confirm-email-change',
      magicLink: 'http://localhost:3000/auth/magic-link/verify?token=abc',
    },
    {
      clientUrl: 'https://app.example.test/',
      emailChange: 'https://app.example.test/auth/confirm-email-change',
      magicLink: 'https://app.example.test/auth/magic-link/verify?token=abc',
    },
    {
      clientUrl: 'https://example.test/app',
      emailChange: 'https://example.test/app/auth/confirm-email-change',
      magicLink: 'https://example.test/app/auth/magic-link/verify?token=abc',
    },
  ])(
    'with no templates links $clientUrl plus the fixed path, as before',
    ({ clientUrl, emailChange, magicLink }) => {
      expect(linksOf(configured({ CLIENT_URL: clientUrl }))).toEqual({
        emailChange,
        magicLink,
      });
    },
  );

  it('puts the fixed path under a base with no path, with one slash', () => {
    const config = configured({
      MAIL_LINKS_CUSTOMER: JSON.stringify({
        emailChangeCode: 'https://id.dishdoo.app',
        magicLink: 'https://id.dishdoo.app/',
      }),
    });

    expect(linksOf(config)).toEqual({
      emailChange: 'https://id.dishdoo.app/auth/confirm-email-change',
      magicLink: 'https://id.dishdoo.app/auth/magic-link/verify?token=abc',
    });
  });

  it('uses a full address as written and keeps its query', () => {
    const config = configured({
      MAIL_LINKS_CUSTOMER: JSON.stringify({
        emailChangeCode: 'https://id.dishdoo.app/account/confirm',
        magicLink: 'https://id.dishdoo.app/sign-in/link?app=customer',
      }),
    });

    expect(linksOf(config)).toEqual({
      emailChange: 'https://id.dishdoo.app/account/confirm',
      magicLink: 'https://id.dishdoo.app/sign-in/link?app=customer&token=abc',
    });
  });

  it('fills {locale} with the language, and with en for one it lacks', () => {
    const config = configured({
      MAIL_LINKS_CUSTOMER: JSON.stringify({
        emailChangeCode: 'https://console.example.test/{locale}/confirm',
        magicLink: 'https://{locale}.example.test/link',
      }),
    });
    // An account record holding a language this build does not carry.
    const unknown = { email: 'user@example.test', locale: storedLocale('xx') };

    expect({
      english: linksOf(config),
      unknown: linksOf(config, unknown),
    }).toEqual({
      english: {
        emailChange: 'https://console.example.test/en/confirm',
        magicLink: 'https://en.example.test/link?token=abc',
      },
      unknown: {
        emailChange: 'https://console.example.test/en/confirm',
        magicLink: 'https://en.example.test/link?token=abc',
      },
    });
  });

  it('gives each audience its own templates, and the seam picks customer', () => {
    const config = configured({
      MAIL_LINKS_CUSTOMER: JSON.stringify({
        emailChangeCode: 'https://app.example.test',
        magicLink: 'https://app.example.test',
      }),
      MAIL_LINKS_STAFF: JSON.stringify({
        emailChangeCode: 'https://console.example.test',
        magicLink: 'https://console.example.test',
      }),
    });
    const link = (audience: MailAudience) =>
      mailLinkFor(config, MAIL_NAME.MAGIC_LINK, audience, ENGLISH, TOKEN);

    expect({
      customer: link(MAIL_AUDIENCE.CUSTOMER),
      staff: link(MAIL_AUDIENCE.STAFF),
      anyRecipient: linksOf(config).magicLink,
    }).toEqual({
      customer: 'https://app.example.test/auth/magic-link/verify?token=abc',
      staff: 'https://console.example.test/auth/magic-link/verify?token=abc',
      anyRecipient: 'https://app.example.test/auth/magic-link/verify?token=abc',
    });
  });

  it('links staff to CLIENT_URL while only the customer set is given', () => {
    const config = configured({
      MAIL_LINKS_CUSTOMER: JSON.stringify({
        emailChangeCode: 'https://app.example.test',
        magicLink: 'https://app.example.test',
      }),
    });

    expect(
      mailLinkFor(
        config,
        MAIL_NAME.EMAIL_CHANGE_CODE,
        MAIL_AUDIENCE.STAFF,
        ENGLISH,
      ),
    ).toBe('http://localhost:3000/auth/confirm-email-change');
  });
});
