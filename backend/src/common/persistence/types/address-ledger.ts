import {
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
  ACCOUNT_RESERVATION_RESULT,
} from '../address-ledger';

export type AddressClaimKind =
  (typeof ADDRESS_CLAIM_KIND)[keyof typeof ADDRESS_CLAIM_KIND];
export type AddressClaimResult =
  (typeof ADDRESS_CLAIM_RESULT)[keyof typeof ADDRESS_CLAIM_RESULT];

export interface AddressLookup {
  address: string;
  now: Date;
}

export interface AddressAvailability extends AddressLookup {
  /** Ignore this owner's claim, while current account addresses still block. */
  owner?: string;
}

export interface AddressRelease {
  address: string;
  owner: string;
}

export interface StoredAddressClaim extends AddressRelease {
  kind: AddressClaimKind;
  lapsesAt: Date;
}

export interface AddressClaimInput extends StoredAddressClaim {
  now: Date;
}

export type AccountReservationResult =
  | { status: typeof ACCOUNT_RESERVATION_RESULT.TAKEN }
  | {
      status: typeof ACCOUNT_RESERVATION_RESULT.RESERVED;
      reservation: AddressRelease;
    };
