export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type ProofMethod = 'passkey' | 'email-code';
export type InvitationPurpose = 'account' | 'first_admin' | 'enrolment';

export interface AdminInvitation {
  id: string;
  email: string;
  name?: string;
  role: string;
  audience?: 'customer' | 'staff';
  status: InvitationStatus;
  invitedBy?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface InvitationPage {
  invitations: AdminInvitation[];
  total: number;
  page: number;
  pages: number;
}

export interface InvitationQuery {
  status: InvitationStatus;
  page: number;
  limit: number;
  actorId?: string;
  sessionGeneration: number;
}

export interface CreateInvitation {
  email: string;
  role: string;
  name?: string;
  locale?: string;
}

export interface InvitationSubmit {
  body: CreateInvitation;
  idempotencyKey: string;
}

export interface InvitationResend {
  id: string;
  idempotencyKey: string;
}

export interface InvitationAcceptance {
  purpose: InvitationPurpose;
  enrolment: boolean;
  user: { id: string; email: string; name: string; role: string };
}

export interface FreshProof {
  provedAt: string;
}

export interface InvitationOperation {
  run: () => Promise<unknown>;
  onSuccess: () => void;
}
