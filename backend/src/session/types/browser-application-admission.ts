import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import type { BrowserEvidence } from './browser-evidence';
import type { IssuanceApplication } from '../issuance/browser-issuance.store';

export type BrowserApplicationAdmission = (
  application: IssuanceApplication,
) => void;

export interface AdmittedBrowserSessionRequest {
  userId: string;
  userAgent: string;
  ip: string;
  clientId: string;
  evidence: BrowserEvidence;
  admit: BrowserApplicationAdmission;
}

export type BrowserIssuanceAdmission =
  | BrowserApplicationAdmission
  | typeof CREDENTIAL_PURPOSE.BROWSER_SESSION
  | typeof CREDENTIAL_PURPOSE.ENROLMENT;
