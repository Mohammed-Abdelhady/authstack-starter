export type ProofMethod = 'passkey' | 'email-code';

export interface FreshProof {
  provedAt: string;
}

export interface StaffOperation {
  run: () => Promise<unknown>;
  onSuccess: () => void;
  isCurrent?: () => boolean;
  onError?: (error: unknown) => void | Promise<void>;
}
