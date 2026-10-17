export interface AdminInviteOptions {
  email: string;
  name?: string;
  locale?: string;
}

export interface AdminRecoverOptions {
  email: string;
  newEmail?: string;
}
