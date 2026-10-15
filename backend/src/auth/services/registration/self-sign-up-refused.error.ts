import { AccountCreationRefusedError } from './account-creation-refused.error';

/** Built-in refusal translated into each self-sign-up method's generic reply. */
export class SelfSignUpRefusedError extends AccountCreationRefusedError {}
