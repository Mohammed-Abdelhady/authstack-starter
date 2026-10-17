import type { BrowserApplicationAdmission } from '../types/browser-application-admission';
import type { BrowserEvidence } from '../types/browser-evidence';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AuthenticatedSession } from '../authority/authenticated-session';
import { BROWSER_APPLICATION_ROUTES } from '../constants/browser-application-routes';
import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { parseBrowserSignIn } from '../../config/utils/host-policy-config.util';
import type { BrowserSignInConfiguration } from '../../config/types/host-policy.type';
import { ADMIN_CLIENT_ID, WEB_CLIENT_ID } from '../constants/client-ids';
import type {
  BrowserApplication,
  BrowserApplicationId,
  BrowserApplicationConfiguration,
  BrowserApplicationEnabledReader,
  BrowserCeremonyReader,
} from './types/browser-application';

@Injectable()
export class BrowserApplications {
  private readonly resolved = new WeakMap<Request, BrowserApplication>();
  private readonly pending = new WeakMap<
    Request,
    Promise<BrowserApplication>
  >();
  private readonly admissions = new WeakMap<
    Request,
    BrowserApplicationAdmission
  >();
  private readonly evidence = new WeakMap<Request, BrowserEvidence>();
  private readonly enabledReads = new WeakMap<
    Request,
    Map<BrowserApplicationId, Promise<boolean>>
  >();
  private readonly ceremonies = new Map<string, BrowserCeremonyReader>();

  constructor(
    private readonly config: ConfigService,
    private readonly readEnabled: BrowserApplicationEnabledReader,
  ) {}

  configuration(
    clientId: BrowserApplicationId,
  ): BrowserApplicationConfiguration {
    const webUrl = this.config.get<string>(
      'cors.clientUrl',
      this.config.get<string>('CLIENT_URL', 'http://localhost:3000'),
    );
    const adminUrl =
      this.config.get<string>('cors.adminUrl') ??
      this.config.get<string>('ADMIN_URL');
    const returnBase = clientId === ADMIN_CLIENT_ID ? adminUrl : webUrl;
    const setting =
      clientId === ADMIN_CLIENT_ID ? 'AUTH_ADMIN_SIGN_IN' : 'AUTH_WEB_SIGN_IN';
    return {
      clientId,
      returnBase: returnBase ?? webUrl,
      origin: new URL(returnBase ?? webUrl).origin,
      signIn:
        this.config.get<BrowserSignInConfiguration>(
          `auth.${clientId}.signIn`,
        ) ?? parseBrowserSignIn(this.config.get<string>(setting), setting),
    };
  }

  isConfigured(clientId: BrowserApplicationId): boolean {
    return (
      clientId === WEB_CLIENT_ID ||
      Boolean(
        this.config.get<string>('cors.adminUrl') ??
        this.config.get<string>('ADMIN_URL'),
      )
    );
  }

  /** With a request, every check of that request shares one stored read per application. */
  async application(
    clientId: BrowserApplicationId,
    request?: Request,
  ): Promise<BrowserApplication> {
    return {
      ...this.configuration(clientId),
      enabled:
        this.isConfigured(clientId) &&
        (await this.storedEnabled(clientId, request)),
    };
  }

  /** Readers verify ceremonies or name a route with a fixed application. */
  registerCeremonyReader(name: string, reader: BrowserCeremonyReader): void {
    this.ceremonies.set(name, reader);
  }

  resolve(request?: Request): Promise<BrowserApplication> {
    if (!request) return this.application(WEB_CLIENT_ID);
    const cached = this.resolved.get(request);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(request);
    if (pending) return pending;
    const resolving = this.resolveCeremony(request);
    this.pending.set(request, resolving);
    return resolving;
  }

  current(request?: Request): BrowserApplicationConfiguration {
    return request
      ? (this.resolved.get(request) ?? this.fromOrigin(request))
      : this.configuration(WEB_CLIENT_ID);
  }

  async remember(
    request: Request,
    clientId: BrowserApplicationId,
  ): Promise<BrowserApplication> {
    const application = await this.application(clientId, request);
    this.resolved.set(request, application);
    return application;
  }

  rememberEvidence(request: Request, evidence: BrowserEvidence): void {
    this.evidence.set(request, evidence);
  }

  evidenceFor(request: Request): BrowserEvidence | undefined {
    return this.evidence.get(request);
  }

  rememberAdmission(
    request: Request,
    admit: BrowserApplicationAdmission,
  ): void {
    this.admissions.set(request, admit);
  }

  admissionFor(request: Request): BrowserApplicationAdmission | undefined {
    return this.admissions.get(request);
  }

  async allowedOrigins(request?: Request): Promise<string[]> {
    const applications = await Promise.all([
      this.application(WEB_CLIENT_ID, request),
      this.application(ADMIN_CLIENT_ID, request),
    ]);
    return applications
      .filter(({ enabled }) => enabled)
      .map(({ origin }) => origin);
  }

  /** The configured origins, read from no store. */
  configuredOrigins(): string[] {
    const clientIds: BrowserApplicationId[] = [WEB_CLIENT_ID, ADMIN_CLIENT_ID];
    return clientIds
      .filter((clientId) => this.isConfigured(clientId))
      .map((clientId) => this.configuration(clientId).origin);
  }

  assertEnabled(application: BrowserApplication): void {
    if (!application.enabled) {
      throw new AppException(
        ErrorCode.APPLICATION_DISABLED,
        'This browser application is disabled',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  isBrowserRequest(
    request: Request & { session?: AuthenticatedSession },
  ): boolean {
    const path = request.path ?? request.url?.split('?')[0] ?? '';
    if (
      BROWSER_APPLICATION_ROUTES.MACHINE.test(path) ||
      BROWSER_APPLICATION_ROUTES.MACHINE_METADATA.test(path)
    ) {
      return false;
    }
    if (
      request.session?.credentialPurpose === CREDENTIAL_PURPOSE.NATIVE_ACCESS
    ) {
      return false;
    }
    // Identity validates native bearer credentials itself, including on public reads.
    return !(
      BROWSER_APPLICATION_ROUTES.IDENTITY.test(path) &&
      /^Bearer\s/iu.test(request.headers?.authorization ?? '')
    );
  }

  private fromOrigin(request: Request): BrowserApplicationConfiguration {
    const admin = this.configuration(ADMIN_CLIENT_ID);
    if (
      this.isConfigured(ADMIN_CLIENT_ID) &&
      request.headers?.origin === admin.origin
    ) {
      return admin;
    }
    return this.configuration(WEB_CLIENT_ID);
  }

  private async resolveCeremony(request: Request): Promise<BrowserApplication> {
    for (const reader of this.ceremonies.values()) {
      const clientId = await reader(request);
      if (clientId) return this.remember(request, clientId);
    }
    const application = await this.application(
      this.fromOrigin(request).clientId,
      request,
    );
    this.resolved.set(request, application);
    return application;
  }

  private storedEnabled(
    clientId: BrowserApplicationId,
    request?: Request,
  ): Promise<boolean> {
    if (!request) return this.readEnabled(clientId);
    let reads = this.enabledReads.get(request);
    if (!reads) {
      reads = new Map();
      this.enabledReads.set(request, reads);
    }
    let read = reads.get(clientId);
    if (!read) {
      read = this.readEnabled(clientId);
      reads.set(clientId, read);
    }
    return read;
  }
}
