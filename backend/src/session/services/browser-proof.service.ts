import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { Clock } from '../../common/services/clock';
import {
  BROWSER_PROOF_TTL_MS,
  browserProofCookieName,
} from '../constants/browser-proof';
import {
  BROWSER_PROOF_CLAIM,
  BrowserProofStore,
} from '../proofs/browser-proof.store';
import {
  hashEquals,
  hashToken,
  randomSecret,
} from '../utils/hashing/token-hash';

@Injectable()
export class BrowserProofService {
  constructor(
    private readonly store: BrowserProofStore,
    private readonly configService: ConfigService,
    private readonly clock: Clock,
  ) {}

  async issue(response: Response): Promise<string> {
    const proofId = randomSecret();
    const token = randomSecret();
    const now = this.clock.now();
    await this.store.issueBrowserProof({
      proofIdHash: hashToken(proofId),
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + BROWSER_PROOF_TTL_MS),
    });
    response.cookie(this.cookieName(), proofId, this.cookieOptions());
    return token;
  }

  async consume(request: Request, presented: string): Promise<void> {
    const proofId = this.readCookie(request);
    if (!proofId) {
      throw new AppException(
        ErrorCode.CSRF_REQUIRED,
        'Browser proof is required',
        HttpStatus.FORBIDDEN,
      );
    }

    const proofIdHash = hashToken(proofId);
    const proof = await this.store.findIssuedBrowserProof(proofIdHash);
    if (!proof || !hashEquals(presented, proof.tokenHash)) {
      throw invalidProof();
    }

    const claim = await this.store.claimBrowserProof(
      proofIdHash,
      this.clock.now(),
    );
    if (claim !== BROWSER_PROOF_CLAIM.CLAIMED) {
      throw invalidProof();
    }
  }

  private cookieName(): string {
    return browserProofCookieName(this.configService.get<string>('NODE_ENV'));
  }

  private cookieOptions(): CookieOptions {
    const production =
      this.configService.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      path: '/',
      maxAge: BROWSER_PROOF_TTL_MS,
    };
  }

  private readCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    const value = cookies?.[this.cookieName()];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return undefined;
  }
}

function invalidProof(): AppException {
  return new AppException(
    ErrorCode.CSRF_INVALID,
    'Browser proof is invalid',
    HttpStatus.FORBIDDEN,
  );
}
