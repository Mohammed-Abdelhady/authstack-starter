import type { Request } from 'express';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { BROWSER_APPLICATION_ROUTES } from '../../session/constants/browser-application-routes';
import { Clock } from '../../common/services/clock';
import { MAGIC_LINK_MAX_TOKEN_LENGTH } from './constants/magic-link.constants';
import {
  MagicLinkStore,
  type UnspentMagicLink,
} from './stores/magic-link.store';
import { hashMagicLinkToken } from './utils/magic-link-token.util';
import { verifiedMagicLinkApplication } from './utils/magic-link-browser-context';

interface PendingLookup {
  token: string;
  result: Promise<UnspentMagicLink | null>;
}

export class MagicLinkCeremonies {
  private readonly lookups = new WeakMap<Request, PendingLookup>();

  constructor(
    private readonly links: MagicLinkStore,
    private readonly applications: BrowserApplications,
    private readonly clock: Clock,
  ) {}

  register(): void {
    this.applications.registerCeremonyReader('magic-link', async (request) => {
      if (
        request.method !== 'POST' ||
        !BROWSER_APPLICATION_ROUTES.MAGIC_LINK_VERIFY.test(request.path)
      ) {
        return undefined;
      }
      const body: unknown = request.body;
      if (typeof body !== 'object' || body === null) return undefined;
      const token: unknown = Reflect.get(body, 'token');
      if (
        typeof token !== 'string' ||
        token.length === 0 ||
        token.length > MAGIC_LINK_MAX_TOKEN_LENGTH
      ) {
        return undefined;
      }
      const pending = await this.pending(request, token);
      return pending ? verifiedMagicLinkApplication(token) : undefined;
    });
  }

  pending(request: Request, token: string): Promise<UnspentMagicLink | null> {
    const previous = this.lookups.get(request);
    if (previous?.token === token) return previous.result;
    const result = this.readPending(token);
    this.lookups.set(request, { token, result });
    return result;
  }

  private async readPending(token: string): Promise<UnspentMagicLink | null> {
    const pending = await this.links.findUnspentLink(hashMagicLinkToken(token));
    return pending && pending.expiresAt.getTime() > this.clock.now().getTime()
      ? pending
      : null;
  }
}
