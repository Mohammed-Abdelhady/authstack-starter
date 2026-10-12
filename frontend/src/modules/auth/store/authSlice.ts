import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/store/store';
import { HTTP_STATUS } from '@/constants/httpStatus';
import type { AuthState, SignedInUser } from '../types/auth.types';
import { authApi } from './authApi';

function httpStatusOf(value: unknown): number {
  if (typeof value !== 'object' || value === null || !('status' in value)) return 0;
  const status = Number(value.status);
  return Number.isFinite(status) ? status : 0;
}

/**
 * Initial authentication state
 * Note: Session managed via httpOnly cookies, no token in state
 */
const initialState: AuthState = {
  pendingRegistrationEmail: null,
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  validationStatus: 'idle',
  validationErrorStatus: null,
  sessionGeneration: 0,
  identityRequest: null,
};

function advanceSessionGeneration(state: AuthState): void {
  state.sessionGeneration += 1;
  state.identityRequest = null;
}

function isCurrentIdentityResponse(state: AuthState, requestId: string): boolean {
  return (
    state.identityRequest?.requestId === requestId &&
    state.identityRequest.sessionGeneration === state.sessionGeneration
  );
}

/**
 * Auth slice managing authentication state
 * Handles user data, loading states, and errors
 */
export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    rememberRegistrationEmail: (state, action: PayloadAction<string | null>) => {
      state.pendingRegistrationEmail = action.payload;
    },
    /**
     * Set authenticated user and mark as logged in
     */
    loginFulfilled: (state, action: PayloadAction<SignedInUser>) => {
      advanceSessionGeneration(state);
      state.user = action.payload;
      state.isAuthenticated = true;
      state.isLoading = false;
      state.error = null;
      state.validationStatus = 'succeeded';
      state.validationErrorStatus = null;
    },

    /**
     * Set user data (for activation flow)
     * Session managed via httpOnly cookie
     */
    setUser: (state, action: PayloadAction<SignedInUser>) => {
      advanceSessionGeneration(state);
      state.user = action.payload;
      state.isAuthenticated = true;
      state.isLoading = false;
      state.error = null;
      state.validationStatus = 'succeeded';
      state.validationErrorStatus = null;
    },

    /**
     * Clear user session and mark as logged out
     * Backend will clear httpOnly cookie
     */
    logout: (state) => {
      advanceSessionGeneration(state);
      state.pendingRegistrationEmail = null;
      state.user = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      state.error = null;
      state.validationStatus = 'idle';
      state.validationErrorStatus = null;
    },

    /**
     * Set loading state for async operations
     */
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },

    /**
     * Set error message
     */
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.isLoading = false;
    },
  },
  extraReducers: (builder) => {
    // Handle login mutation lifecycle
    builder.addMatcher(authApi.endpoints.login.matchPending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    // A reply without a user means the account still owes a second factor, so
    // there is no session to record yet.
    builder.addMatcher(
      isAnyOf(authApi.endpoints.login.matchFulfilled, authApi.endpoints.activate.matchFulfilled),
      (state, action) => {
        state.isLoading = false;
        state.error = null;
        if (action.payload.user === null) {
          return;
        }
        advanceSessionGeneration(state);
        state.user = action.payload.user;
        state.isAuthenticated = true;
        state.validationStatus = 'succeeded';
        state.validationErrorStatus = null;
      },
    );
    builder.addMatcher(authApi.endpoints.login.matchRejected, (state, action) => {
      state.isLoading = false;
      state.error = action.error.message || 'Login failed';
    });

    // Handle logout mutation lifecycle
    builder.addMatcher(authApi.endpoints.logout.matchFulfilled, (state) => {
      advanceSessionGeneration(state);
      state.user = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      state.error = null;
      state.validationStatus = 'idle';
      state.validationErrorStatus = null;
    });

    // Optional identity is the authoritative source for session state.
    builder.addMatcher(authApi.endpoints.getIdentity.matchPending, (state, action) => {
      state.identityRequest = {
        requestId: action.meta.requestId,
        sessionGeneration: state.sessionGeneration,
      };
      state.isLoading = true;
      // Keep a validated session visible while a background identity refresh runs.
      if (state.validationStatus === 'succeeded') return;
      state.validationStatus = 'pending';
      state.validationErrorStatus = null;
    });
    builder.addMatcher(authApi.endpoints.getIdentity.matchFulfilled, (state, action) => {
      if (!isCurrentIdentityResponse(state, action.meta.requestId)) return;
      advanceSessionGeneration(state);
      state.isLoading = false;
      state.error = null;
      state.user = action.payload.authenticated ? action.payload.user : null;
      state.isAuthenticated = action.payload.authenticated;
      state.validationStatus = 'succeeded';
      state.validationErrorStatus = null;
    });
    builder.addMatcher(authApi.endpoints.getIdentity.matchRejected, (state, action) => {
      if (!isCurrentIdentityResponse(state, action.meta.requestId)) return;
      state.identityRequest = null;
      state.isLoading = false;
      const status = httpStatusOf(action.payload);
      // A failed refresh is unknown, not signed out. Only a completed identity
      // reply can replace a previously validated account.
      if (state.validationStatus === 'succeeded' && status !== HTTP_STATUS.UNAUTHORIZED) return;
      state.validationStatus = 'failed';
      state.validationErrorStatus = status;
      if (status === HTTP_STATUS.UNAUTHORIZED) {
        advanceSessionGeneration(state);
        state.user = null;
        state.isAuthenticated = false;
      }
    });
  },
});

// Export actions
export const { loginFulfilled, setUser, logout, setLoading, setError, rememberRegistrationEmail } =
  authSlice.actions;

// Selectors
export const selectUser = (state: RootState) => state.auth.user;
export const selectIsAuthenticated = (state: RootState) => state.auth.isAuthenticated;
export const selectAuthLoading = (state: RootState) => state.auth.isLoading;
export const selectAuthError = (state: RootState) => state.auth.error;
export const selectValidationStatus = (state: RootState) => state.auth.validationStatus;
export const selectValidationErrorStatus = (state: RootState) => state.auth.validationErrorStatus;

// Export reducer
export default authSlice.reducer;
