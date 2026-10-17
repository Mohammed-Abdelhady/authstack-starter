import { ConfigService } from '@nestjs/config';
import { BrowserApplications } from '../../src/session/applications/browser-applications';
import request from 'supertest';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from '../../src/common/constants/locales';
import { escapeHtml } from '../../src/common/utils/escape-html';
import { MailService } from '../../src/mail/mail.service';
import { MAIL_CATALOGUES } from '../../src/mail/catalog/mail-catalogue';
import { LINK_HOST_ASSOCIATION_PATHS } from '../../src/session/native/association/constants/link-host';
import { linkHostManifest } from '../../src/session/native/association/link-host-paths';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  ANDROID_CERTIFICATE,
  ANDROID_SECOND_CERTIFICATE,
  API_HOST,
  LINK_APPLICATIONS,
  LINK_HOST,
  configureLinkHost,
  mountLinkHostSwagger,
} from '../utils/native/link-host.fixture';

// Failure: the passkey link host serves scripts or API authority.
describe('native link host boundary', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeApplications: LINK_APPLICATIONS,
      beforeStart: configureLinkHost,
      afterHttpSetup: mountLinkHostSwagger,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('serves exactly the qualifying application associations as JSON without redirect', async () => {
    const apple = await request(e2e.httpServer)
      .get(LINK_HOST_ASSOCIATION_PATHS.APPLE)
      .set('Host', LINK_HOST)
      .expect('Content-Type', /application\/json/u)
      .expect(200);
    expect(apple.headers.location).toBeUndefined();
    expect(apple.headers['x-powered-by']).toBeUndefined();
    expect(apple.body).toEqual({
      applinks: {
        apps: [],
        details: [
          { appID: 'TEAM123456.com.example.both', paths: ['/handoff'] },
          { appID: 'TEAM123456.com.example.apple', paths: ['/apple'] },
        ],
      },
      webcredentials: {
        apps: ['TEAM123456.com.example.both', 'TEAM123456.com.example.apple'],
      },
    });
    const android = await request(e2e.httpServer)
      .get(LINK_HOST_ASSOCIATION_PATHS.ANDROID)
      .set('Host', LINK_HOST)
      .expect('Content-Type', /application\/json/u)
      .expect(200);
    expect(android.headers.location).toBeUndefined();
    expect(android.body).toEqual([
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'com.example.both',
          sha256_cert_fingerprints: [ANDROID_CERTIFICATE],
        },
      },
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'com.example.android',
          sha256_cert_fingerprints: [
            ANDROID_CERTIFICATE,
            ANDROID_SECOND_CERTIFICATE,
          ],
        },
      },
    ]);
  });

  it('isolates actual API and Swagger routes using raw Host despite forwarded-host headers', async () => {
    await request(e2e.httpServer)
      .get('/health')
      .set('Host', API_HOST)
      .expect(200);
    await request(e2e.httpServer)
      .get('/api/docs/')
      .set('Host', API_HOST)
      .expect(200);
    for (const path of [
      '/health',
      '/api/auth/identity',
      '/api/docs/',
      '/api/docs-json',
      '/assets/app.js',
    ]) {
      const denied = await request(e2e.httpServer)
        .get(path)
        .set('Host', LINK_HOST)
        .set('X-Forwarded-Host', API_HOST)
        .expect(404);
      expect(denied.text).toBe('');
      expect(denied.headers['x-powered-by']).toBeUndefined();
    }
    for (const path of Object.values(LINK_HOST_ASSOCIATION_PATHS)) {
      await request(e2e.httpServer)
        .get(path)
        .set('Host', API_HOST)
        .set('X-Forwarded-Host', LINK_HOST)
        .expect(404);
    }
    await request(e2e.httpServer)
      .get('/health')
      .set('Host', API_HOST)
      .set('X-Forwarded-Host', LINK_HOST)
      .expect(200);
    await request(e2e.httpServer)
      .get(LINK_HOST_ASSOCIATION_PATHS.APPLE)
      .set('Host', 'LINKS.example.test.:8443')
      .expect(200);
    await request(e2e.httpServer)
      .post('/handoff')
      .set('Host', LINK_HOST)
      .send({})
      .expect(404);
    await request(e2e.httpServer)
      .head('/handoff')
      .set('Host', LINK_HOST)
      .expect(200);
  });

  it.each(SUPPORTED_LOCALES)(
    'serves one non-reflecting script-free page for every effective path in %s',
    async (locale) => {
      const manifest = linkHostManifest(
        e2e.app.get(ConfigService),
        e2e.app.get(BrowserApplications),
      );
      let body: string | undefined;
      for (const path of manifest.paths) {
        const response = await request(e2e.httpServer)
          .get(`${path}?untrusted=%3Cscript%3Ereflected-secret%3C/script%3E`)
          .set('Host', LINK_HOST)
          .set('Accept-Language', locale)
          .set('Referer', 'https://untrusted.example/reflected-secret')
          .expect('Content-Type', /text\/html/u)
          .expect(200);
        expect(response.headers['content-language']).toBe(locale);
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['x-robots-tag']).toContain('noindex');
        expect(response.headers['content-security-policy']).toContain(
          "script-src 'none'",
        );
        expect(response.headers.location).toBeUndefined();
        expect(response.headers['x-powered-by']).toBeUndefined();
        expect(response.text).not.toMatch(/<script\b/iu);
        expect(response.text).not.toContain('reflected-secret');
        expect(response.text).toContain(
          escapeHtml(MAIL_CATALOGUES[locale].common.nativeLinkMessage),
        );
        if (body === undefined) body = response.text;
        else expect(response.text).toBe(body);
      }
      const repeated = await request(e2e.httpServer)
        .get('/handoff?different=another-secret')
        .set('Host', 'LINKS.example.test.:8443')
        .set('X-Forwarded-Host', 'untrusted.example')
        .set('Accept-Language', `${locale}-ZZ,untrusted;q=0.1`)
        .expect(200);
      expect(repeated.text).toBe(body);
    },
  );

  it('crosses the real mail button handoff and defaults unknown languages safely', async () => {
    await e2e.app
      .get(MailService)
      .sendEmailChangeCode(
        { email: 'link-host@example.test', locale: DEFAULT_LOCALE },
        '123456',
      );
    const mail = await e2e.captureMail();
    const text = mail.at(-1)?.text;
    const link =
      typeof text === 'string'
        ? text.match(/https?:\/\/[^\s]+/u)?.[0]
        : undefined;
    if (!link) throw new Error('Confirmation mail carried no link');
    expect(new URL(link).pathname).toBe('/en/confirm');
    const fromMail = await request(e2e.httpServer)
      .get(new URL(link).pathname)
      .set('Host', LINK_HOST)
      .set('Accept-Language', 'untrusted-<script>-reflected-secret')
      .expect(200);
    const english = await request(e2e.httpServer)
      .get('/handoff')
      .set('Host', LINK_HOST)
      .set('Accept-Language', DEFAULT_LOCALE)
      .expect(200);
    expect(fromMail.text).toBe(english.text);
    expect(fromMail.text).not.toContain('123456');
  });
});

// Failure: leaving the setting absent unexpectedly takes over a product's host.
describe('native link host absent', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) => {
        configureLinkHost(app, false);
        app.get(ConfigService).set('AUTH_NATIVE_LINK_HOST', LINK_HOST);
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  it('leaves ordinary routing intact and serves no link resources', async () => {
    await request(e2e.httpServer)
      .get('/health')
      .set('Host', LINK_HOST)
      .expect(200);
    for (const path of [
      ...Object.values(LINK_HOST_ASSOCIATION_PATHS),
      '/en/confirm',
    ]) {
      await request(e2e.httpServer)
        .get(path)
        .set('Host', LINK_HOST)
        .expect(404);
    }
    const manifest = linkHostManifest(
      e2e.app.get(ConfigService),
      e2e.app.get(BrowserApplications),
    );
    expect(manifest.host).toBeUndefined();
    expect(manifest.paths).toEqual([]);
  });
});
