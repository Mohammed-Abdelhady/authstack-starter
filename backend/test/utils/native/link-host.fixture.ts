import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { API_GLOBAL_PREFIX } from '../../../src/common/constants/http-routes';
import { SessionCookieService } from '../../../src/auth/services/sessions/session-cookie.service';
import { buildOpenApiDocument } from '../../../src/common/swagger/build-openapi-document';
import type { NativeApplicationConfiguration } from '../../../src/config/types/native-application.type';
import type { MailLinkSettings } from '../../../src/mail/links/mail-links';
import { MAIL_NAME } from '../../../src/mail/constants/mail-names';

export const LINK_HOST = 'links.example.test';
export const API_HOST = 'api.example.test';
export const ANDROID_CERTIFICATE = Array.from({ length: 32 }, () => 'A1').join(
  ':',
);
export const ANDROID_SECOND_CERTIFICATE = Array.from(
  { length: 32 },
  () => 'B2',
).join(':');

export const LINK_APPLICATIONS: NativeApplicationConfiguration[] = [
  {
    clientId: 'both-platforms',
    displayName: 'Both platforms',
    allowedScopes: ['api'],
    redirectUris: [`https://${LINK_HOST}/handoff`],
    appleAppId: 'TEAM123456.com.example.both',
    androidPackage: 'com.example.both',
    androidCertificates: [ANDROID_CERTIFICATE],
  },
  {
    clientId: 'apple-only',
    displayName: 'Apple only',
    allowedScopes: ['api'],
    redirectUris: [`https://${LINK_HOST}/apple`],
    appleAppId: 'TEAM123456.com.example.apple',
    androidPackage: 'com.example.missingcert',
  },
  {
    clientId: 'android-only',
    displayName: 'Android only',
    allowedScopes: ['api'],
    redirectUris: [`https://${LINK_HOST}/android`],
    androidPackage: 'com.example.android',
    androidCertificates: [ANDROID_CERTIFICATE, ANDROID_SECOND_CERTIFICATE],
  },
  {
    clientId: 'unassociated',
    displayName: 'No association',
    allowedScopes: ['api'],
    redirectUris: [`https://${LINK_HOST}/unassociated`],
  },
  {
    clientId: 'certificate-only',
    displayName: 'No package',
    allowedScopes: ['api'],
    redirectUris: [`https://${LINK_HOST}/certificate-only`],
    androidCertificates: [ANDROID_CERTIFICATE],
  },
];

export function configureLinkHost(app: INestApplication, enabled = true): void {
  const config = app.get(ConfigService);
  config.set('auth.nativeLinkHost', enabled ? LINK_HOST : undefined);
  config.set('cors.adminUrl', 'https://admin.example.test/console');
  const links: MailLinkSettings = {
    customer: {
      [MAIL_NAME.EMAIL_CHANGE_CODE]: `https://${LINK_HOST}/{locale}/confirm`,
      [MAIL_NAME.MAGIC_LINK]: `https://${LINK_HOST}/{locale}/sign-in`,
    },
    staff: {
      [MAIL_NAME.EMAIL_CHANGE_CODE]: `https://${LINK_HOST}/staff/confirm`,
      [MAIL_NAME.MAGIC_LINK]: `https://${LINK_HOST}/staff/sign-in`,
    },
  };
  config.set('mail.links', links);
}

export function mountLinkHostSwagger(app: INestApplication): void {
  const cookies = app.get(SessionCookieService);
  SwaggerModule.setup(
    `${API_GLOBAL_PREFIX}/docs`,
    app,
    SwaggerModule.createDocument(app, buildOpenApiDocument(cookies.name)),
  );
}
