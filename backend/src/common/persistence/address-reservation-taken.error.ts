import { ACCOUNT_CONSTRAINT } from '../../user/stores/stored-account';
import { UniqueConflictError } from './persistence-errors';

export class AddressReservationTakenError extends UniqueConflictError {
  constructor() {
    super(ACCOUNT_CONSTRAINT.EMAIL);
  }
}
