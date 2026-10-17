import type { UserProfileDto } from '../../user/dto/user-profile.dto';

export type IdentityData =
  | { authenticated: false; user: null }
  | { authenticated: true; user: UserProfileDto; enrolment?: true };
