import type { Request, Response } from 'express';
import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';

export interface BrowserOAuthStart {
  readonly providerId: string;
  readonly redirect: string | undefined;
  readonly intent: string | undefined;
  readonly request: Request;
  readonly response: Response;
  readonly clientId?: BrowserApplicationId;
}
