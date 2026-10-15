import { ConfigService } from '@nestjs/config';
import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
// feature:magic-link:start
import { DEFAULT_LOCALE } from '../../../common/constants/locales';
import { browserMagicLinkUrl } from '../../../auth/magic-link/utils/magic-link-browser-context';
import { ADMIN_CLIENT_ID } from '../../constants/client-ids';
// feature:magic-link:end
import { appleAssociation } from './link-host-associations';
import type { NativeApplicationConfiguration } from '../../../config/types/native-application.type';
import { SUPPORTED_LOCALES } from '../../../common/constants/locales';
import {
  LINKED_MAIL_NAMES,
  MAIL_NAME,
} from '../../../mail/constants/mail-names';
import { MAIL_AUDIENCE, mailLinkFor } from '../../../mail/links/mail-links';
import { canonicalLinkHostPath } from './link-host-path';
import { effectiveLinkHostPaths, linkHostManifest } from './link-host-paths';

// Failure: custom/localised mail paths drift from the closed host allowlist.
describe('effective link-host paths', () => {
  it('reads default and custom localised paths from real mail URL outputs', () => {
    const config = new ConfigService({
      auth: {
        nativeEnabled: true,
        nativeLinkHost: 'links.example.test',
        nativeApplications: [
          {
            clientId: 'mobile',
            redirectUris: ['https://links.example.test/handoff'],
          },
        ],
      },
      cors: { clientUrl: 'https://web.example.test/base' },
      mail: {
        links: {
          staff: {
            [MAIL_NAME.EMAIL_CHANGE_CODE]:
              'https://links.example.test/{locale}/verify',
            [MAIL_NAME.MAGIC_LINK]: 'https://links.example.test/',
          },
        },
      },
    });
    const paths = effectiveLinkHostPaths(
      config,
      browserApplicationsForTest(config),
    );
    expect(paths).toEqual(
      [
        '/auth/magic-link/verify',
        '/base/auth/confirm-email-change',
        '/base/auth/magic-link/verify',
        '/en/verify',
        '/ar/verify', // feature:locale-ar
        '/handoff',
      ].sort(),
    );
    for (const locale of SUPPORTED_LOCALES) {
      for (const audience of Object.values(MAIL_AUDIENCE)) {
        for (const mail of LINKED_MAIL_NAMES) {
          const written = mailLinkFor(config, mail, audience, {
            email: '',
            locale,
          });
          expect(paths).toContain(new URL(written).pathname);
        }
      }
    }
  });

  it.each([
    '/api/auth/identity',
    '/health',
    '/docs/index',
    '/assets/app.js',
    '/_next/main.js',
    '/static/main.js',
    '/swagger/index',
    '/api-docs',
    '/.well-known/acme-challenge',
    '/.well-known/acme-challenge/token',
    '/API/auth/identity',
    '/%2fapi',
    '/back%5cslash',
    '/control%0a',
    '/twice%252fencoded',
    '/space%20path',
  ])(
    'refuses reserved or ambiguous configured native path %s with its owner',
    (path) => {
      const config = new ConfigService({
        auth: {
          nativeLinkHost: 'links.example.test',
          nativeEnabled: true,
          nativeApplications: [
            {
              clientId: 'mobile',
              redirectUris: [`https://links.example.test${path}`],
            },
          ],
        },
      });
      expect(() =>
        effectiveLinkHostPaths(config, browserApplicationsForTest(config)),
      ).toThrow(/AUTH_NATIVE_APPLICATIONS.*mobile.*redirectUris/u);
    },
  );

  it('names a custom mail setting when its path conflicts with an API route', () => {
    const config = new ConfigService({
      mail: {
        links: {
          customer: {
            [MAIL_NAME.EMAIL_CHANGE_CODE]:
              'https://links.example.test/api/auth/identity',
            [MAIL_NAME.MAGIC_LINK]: 'https://links.example.test/sign-in',
          },
        },
      },
    });
    expect(() =>
      effectiveLinkHostPaths(config, browserApplicationsForTest(config)),
    ).toThrow(/MAIL_LINKS_CUSTOMER.*emailChangeCode/u);
  });

  it('keeps unrelated prefixes and Unicode but rejects incoming ambiguity', () => {
    expect(canonicalLinkHostPath('/apiary')).toBe('/apiary');
    expect(canonicalLinkHostPath('/mail/%D8%B1%D9%85%D8%B2')).toBe('/mail/رمز');
    expect(canonicalLinkHostPath('/%ZZ')).toBeUndefined();
    expect(canonicalLinkHostPath('/%3fsecret')).toBeUndefined();
    expect(canonicalLinkHostPath('/a/../handoff')).toBeUndefined();
    expect(canonicalLinkHostPath('/a//handoff')).toBeUndefined();
  });

  it('maps a custom-scheme root to the fixed root page', () => {
    const config = new ConfigService({
      auth: {
        nativeEnabled: true,
        nativeApplications: [
          { clientId: 'mobile', redirectUris: ['myapp://callback'] },
        ],
      },
    });
    expect(
      effectiveLinkHostPaths(config, browserApplicationsForTest(config)),
    ).toContain('/');
  });

  it('keeps manifest metadata with only a stale raw host', () => {
    const config = new ConfigService({
      AUTH_NATIVE_LINK_HOST: 'links.example.test',
    });
    const manifest = linkHostManifest(
      config,
      browserApplicationsForTest(config),
    );
    expect(manifest).toEqual({
      host: undefined,
      paths: [],
      apiPrefix: 'api',
      reservedPathPrefixes: [
        '/api',
        '/health',
        '/docs',
        '/api-docs',
        '/swagger',
        '/assets',
        '/_next',
        '/static',
        '/.well-known/acme-challenge',
      ],
      associationPaths: [
        '/.well-known/apple-app-site-association',
        '/.well-known/assetlinks.json',
      ],
      acmeChallengePrefix: '/.well-known/acme-challenge/',
    });
  });

  it('canonicalises the parsed host despite a stale raw value', () => {
    const config = new ConfigService({
      auth: { nativeLinkHost: 'LINKS.example.test.' },
      AUTH_NATIVE_LINK_HOST: 'stale.example.test',
    });
    expect(
      linkHostManifest(config, browserApplicationsForTest(config)).host,
    ).toBe('links.example.test');
  });

  // feature:magic-link:start
  it('uses browser application metadata for admin mail paths', () => {
    const config = new ConfigService({
      cors: { clientUrl: 'https://web.example.test' },
      ADMIN_URL: 'https://admin.example.test/console',
    });
    const applications = browserApplicationsForTest(config);
    const written = browserMagicLinkUrl(
      config,
      applications.configuration(ADMIN_CLIENT_ID),
      { email: '', locale: DEFAULT_LOCALE },
      '',
    );
    const paths = effectiveLinkHostPaths(config, applications);
    expect(paths).toContain('/console/auth/magic-link/verify');
    expect(paths).toContain(new URL(written).pathname);
  });
  // feature:magic-link:end
});

// Failure: foreign or custom-scheme redirects claim Universal Link paths.
describe('Apple link-host associations', () => {
  it('claims canonical own-host HTTPS paths only', () => {
    const applications: NativeApplicationConfiguration[] = [
      {
        clientId: 'mobile',
        displayName: 'Mobile',
        allowedScopes: [],
        appleAppId: 'TEAM123456.com.example.mobile',
        redirectUris: [
          'myapp://callback',
          'https://foreign.example.test/foreign',
          'http://links.example.test/insecure',
          'https://LINKS.example.test./handoff',
          'https://links.example.test/mail/%D8%B1%D9%85%D8%B2',
          'https://links.example.test/api/auth/identity',
          'https://links.example.test/%2fambiguous',
        ],
      },
      {
        clientId: 'mobile-duplicate',
        displayName: 'Mobile duplicate',
        allowedScopes: [],
        appleAppId: 'TEAM123456.com.example.mobile',
        redirectUris: ['https://links.example.test/handoff'],
      },
      {
        clientId: 'credentials-only',
        displayName: 'Credentials only',
        allowedScopes: [],
        appleAppId: 'TEAM123456.com.example.credentials',
        redirectUris: ['myapp://callback', 'https://foreign.example.test'],
      },
    ];
    expect(appleAssociation(applications, 'LINKS.example.test.')).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appID: 'TEAM123456.com.example.mobile',
            paths: ['/handoff', '/mail/رمز'],
          },
        ],
      },
      webcredentials: {
        apps: [
          'TEAM123456.com.example.mobile',
          'TEAM123456.com.example.credentials',
        ],
      },
    });
  });
});
