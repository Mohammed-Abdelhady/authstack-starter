/**
 * What only the admin and permission cases do to a stored account, behind the
 * server's back.
 */
export interface E2eRecordsState {
  /** Changes the role behind the server's back. */
  changeAccountRole(id: string, role: string): Promise<void>;
  /** Marks the account deleted behind the server's back. Ends no session. */
  markAccountDeleted(id: string): Promise<void>;
  /** Replaces the account's own permissions behind the server's back. */
  replaceAccountPermissions(id: string, permissions: string[]): Promise<void>;
  /** Moves the account to another address generation, as a concurrent address change would. */
  moveAddressGeneration(
    id: string,
    generation: number,
    isVerified: boolean,
  ): Promise<void>;
}
