export interface RecordVersionHarness {
  seed(): Promise<{ accountId: string; roleId: string }>;
  accountVersion(id: string): Promise<number | undefined>;
  roleVersion(id: string): Promise<number | undefined>;
  editAccount(id: string): Promise<void>;
  editBookkeeping(id: string): Promise<void>;
  editRole(id: string): Promise<void>;
  mongoWrites?: (accountId: string, roleId: string) => Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}
