import { HttpStatus, applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import {
  NATIVE_ACCESS_TOKEN_TYPE,
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_NONCE_HEADER,
  NATIVE_DPOP_PROOF_HEADER,
} from '../../constants/session-policy';
import { OAUTH_ERROR } from './native-oauth.types';
import { ErrorCode } from '../../../common/enums/error-code.enum';

const ACCOUNT_MISMATCH_DESCRIPTION = `${ErrorCode.NATIVE_AUTHORIZE_ACCOUNT_MISMATCH} when expectedUserId is not the signed-in account. Nothing changes and the request stays pending.`;

const AUTHORIZE_QUERY_DOCUMENTATION: Array<{
  name: string;
  description: string;
  required?: boolean;
  example?: string;
}> = [
  {
    name: 'response_type',
    description: 'Authorization response type',
    example: 'code',
  },
  { name: 'client_id', description: 'Registered native application id' },
  {
    name: 'redirect_uri',
    description: 'Registered application callback address',
  },
  { name: 'code_challenge', description: 'Base64url PKCE challenge' },
  {
    name: 'code_challenge_method',
    description: 'PKCE challenge method',
    example: 'S256',
  },
  {
    name: 'state',
    description: 'Opaque caller state returned to the callback',
  },
  {
    name: 'scope',
    description: 'Space-delimited requested scopes',
    required: false,
  },
];

export function ApiNativeAuthorizeStart(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Start native authorization',
      description:
        'Validates the client request and redirects to the localized browser confirmation page.',
    }),
    ...AUTHORIZE_QUERY_DOCUMENTATION.map(
      ({ name, description, required, example }) =>
        ApiQuery({
          name,
          description,
          required: required ?? true,
          ...(example ? { example } : {}),
        }),
    ),
    ApiResponse({
      status: 302,
      description: 'Redirects to the localized native authorization page',
      headers: {
        Location: {
          description: 'Localized browser confirmation URL',
          schema: { type: 'string' },
        },
      },
    }),
    ApiBadRequestResponse({
      description:
        'Invalid authorize request. The body is OAuth JSON, for example {"error":"invalid_request"}.',
    }),
  );
}

export function ApiNativeTokenExchange(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Exchange a native authorization code or refresh token',
      description: `A valid DPoP proof binds an authorization-code token pair to its key. Bound refresh tokens need a fresh proof from that key with ath set to the presented token. Unbound families ignore a DPoP header and remain unbound. When AUTH_NATIVE_DPOP_REQUIRED is enabled, an exchange without proof and a refresh of an unbound family return ${OAUTH_ERROR.INVALID_DPOP_PROOF} with ${NATIVE_DPOP_FAILURE_REASON.REQUIRED}. A lost refresh response can be retried once within five minutes with a fresh proof while the successor pair is unused. If that replacement response is also lost, another retry during the original window returns ${OAUTH_ERROR.INVALID_DPOP_PROOF} with ${NATIVE_DPOP_FAILURE_REASON.RETRY_IN_PROGRESS}; after the window, or if the successor was used, the family ends with ${OAUTH_ERROR.INVALID_GRANT} and the user must sign in again. A completed code exchange replay returns ${OAUTH_ERROR.INVALID_GRANT} because the code is consumed. Access tokens remain bearer credentials with a five-minute maximum lifetime; API calls do not require DPoP proofs. token_type is always ${NATIVE_ACCESS_TOKEN_TYPE}, for a bound pair too, and that is the Authorization scheme to send.`,
    }),
    ApiHeader({
      name: NATIVE_DPOP_PROOF_HEADER,
      required: false,
      description:
        'ES256 proof for an authorization-code or bound refresh request',
    }),
    ApiResponse({
      status: HttpStatus.BAD_REQUEST,
      description: `${OAUTH_ERROR.INVALID_DPOP_PROOF} identifies a refused proof or a required-mode refusal. ${OAUTH_ERROR.USE_DPOP_NONCE} includes a fresh nonce response header. A missing body or a field that is present and not a string returns ${OAUTH_ERROR.INVALID_REQUEST}. Unknown or consumed codes return ${OAUTH_ERROR.INVALID_GRANT}.`,
      headers: {
        [NATIVE_DPOP_NONCE_HEADER]: {
          description: 'Fresh server nonce for the next signed proof',
          schema: { type: 'string' },
        },
      },
    }),
  );
}

export function ApiNativeRevoke(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Revoke a native token family',
      description: `Revoking a bound token requires a fresh DPoP proof from its bound key with ath set to the presented token. Unbound families ignore a DPoP header. Invalid proofs return ${OAUTH_ERROR.INVALID_DPOP_PROOF}; ${OAUTH_ERROR.USE_DPOP_NONCE} includes a fresh DPoP-Nonce response header.`,
    }),
    ApiHeader({
      name: NATIVE_DPOP_PROOF_HEADER,
      required: false,
      description: 'ES256 proof for a bound token revocation',
    }),
    ApiResponse({
      status: HttpStatus.OK,
      description: 'The token family was revoked, or the token was unknown.',
    }),
    ApiBadRequestResponse({
      description: `${OAUTH_ERROR.INVALID_DPOP_PROOF} identifies a refused proof. A missing body, a missing token, or a field that is present and not a string returns ${OAUTH_ERROR.INVALID_REQUEST}.`,
      headers: {
        [NATIVE_DPOP_NONCE_HEADER]: {
          description: 'Fresh server nonce for the next signed proof',
          schema: { type: 'string' },
        },
      },
    }),
  );
}

export function ApiNativeAuthorizeApproveErrors(): MethodDecorator {
  return applyDecorators(
    ApiBadRequestResponse({
      description:
        'VALIDATION_ERROR when the transaction id is missing, or expectedUserId is missing or not a string',
    }),
    ApiForbiddenResponse({
      description:
        'Browser proof is invalid, native sign-in is disabled, or GRANT_BLOCKED',
    }),
    ApiNotFoundResponse({
      description: 'USER_NOT_FOUND or NATIVE_TRANSACTION_EXPIRED',
    }),
    ApiConflictResponse({ description: ACCOUNT_MISMATCH_DESCRIPTION }),
  );
}

export function ApiNativeAuthorizeDenyErrors(): MethodDecorator {
  return applyDecorators(
    ApiBadRequestResponse({
      description:
        'VALIDATION_ERROR when the transaction id is missing, or expectedUserId is missing or not a string',
    }),
    ApiForbiddenResponse({
      description: 'Browser proof is invalid or native sign-in is disabled',
    }),
    ApiNotFoundResponse({ description: 'The transaction is expired or ended' }),
    ApiConflictResponse({ description: ACCOUNT_MISMATCH_DESCRIPTION }),
  );
}
