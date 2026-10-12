import type { User } from '@app/sdk';

/**
 * The account as a sign-in reply carries it. Only the profile endpoint reports
 * the rest of `User`.
 */
export type SignedInUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'permissions'>;

/**
 * Authentication state managed by Redux
 * Session tokens stored in httpOnly cookies (not in Redux state)
 */
export interface AuthState {
  pendingRegistrationEmail?: string | null;
  user: SignedInUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  validationStatus: 'idle' | 'pending' | 'succeeded' | 'failed';
  validationErrorStatus: number | null;
  sessionGeneration: number;
  identityRequest: { requestId: string; sessionGeneration: number } | null;
}

/**
 * Login request payload
 */
export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * Body every sign-in route returns. When the account owes a second factor
 * there is no session yet, so `user` is null and the code goes to /auth/2fa.
 */
export interface LoginResponse {
  requiresTwoFactor: boolean;
  user: SignedInUser | null;
  message?: string;
  /** Continuation stored on a mailed link, echoed back by the verify step. */
  redirect?: string;
}

/**
 * Auth error details
 */
export interface AuthError {
  message: string;
  code?: string;
  field?: string;
}

/**
 * Registration request payload
 */
export interface RegisterRequest {
  email: string;
}

/**
 * Registration response from API
 */
export interface RegisterResponse {
  success: boolean;
  message: string;
  data: {
    email: string;
  };
}

/**
 * Account activation request payload
 */
export interface EmailCodeRequest {
  email: string;
  code: string;
}

export interface ActivateRequest extends EmailCodeRequest {
  password: string;
  name: string;
}

/**
 * Account activation response from API
 * Uses httpOnly cookies for session management (no token in response)
 */
export interface ActivateResponse extends LoginResponse {
  mustSignIn: boolean;
}

/**
 * Resend activation code request payload
 */
export interface ResendActivationRequest {
  email: string;
}

/**
 * Resend activation code response from API
 */
export interface ResendActivationResponse {
  success: boolean;
  message: string;
  data: {
    email: string;
  };
}

/**
 * Forgot password request payload
 */
export interface ForgotPasswordRequest {
  email: string;
}

/**
 * Forgot password response from API
 */
export interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

/**
 * Reset password request payload
 */
export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

/**
 * Reset password response from API
 */
export interface ResetPasswordResponse {
  success: boolean;
  message: string;
}
