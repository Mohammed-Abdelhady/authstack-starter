/** Today's database ledger remains canonical; plan 4 adds invitation callers.
 * isFree is advisory. Writers use claim/reserveForAccount in their write UOW.
 */
export {
  AddressLedger,
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
  ACCOUNT_RESERVATION_RESULT,
} from '../../common/persistence/address-ledger';
export type {
  AccountReservationResult,
  AddressClaimKind,
  AddressAvailability,
  AddressClaimInput,
  AddressClaimResult,
  AddressLookup,
  AddressRelease,
  OwnedAddressLookup,
  StoredAddressClaim,
} from '../../common/persistence/types/address-ledger';
