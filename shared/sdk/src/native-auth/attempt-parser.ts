import {
  NATIVE_AUTH_FIRST_FACTOR,
  NATIVE_AUTH_LIMITS,
  NATIVE_AUTH_PATTERN,
  NATIVE_AUTH_SECOND_FACTOR,
  NATIVE_AUTH_STAGE,
} from '@app/core';
import { requireArray, requireObject } from '../shapes';
import type {
  NativeAccountSummary,
  NativeApplicationSummary,
  NativeAttemptResult,
  NativeAttemptStartResult,
  NativeAttemptView,
  NativeFirstFactor,
  NativeSecondFactor,
} from '../types/native-auth';
import {
  booleanValue,
  boundedString,
  boundedStringList,
  email,
  exactKeys,
  fail,
  isoDate,
} from './validation';
import type { JsonObject } from './validation';

function isFirstFactor(value: string): value is NativeFirstFactor {
  return Object.values(NATIVE_AUTH_FIRST_FACTOR).some((allowed) => allowed === value);
}

function isSecondFactor(value: string): value is NativeSecondFactor {
  return Object.values(NATIVE_AUTH_SECOND_FACTOR).some((allowed) => allowed === value);
}

function parseFactors<T extends string>(
  value: unknown,
  field: string,
  isAllowed: (value: string) => value is T,
  bounds: { status: number; minimum: number },
): T[] {
  const { status, minimum } = bounds;
  const items = requireArray(value, field, status);
  if (items.length < minimum || items.length > NATIVE_AUTH_LIMITS.FACTOR_COUNT) {
    fail(status, field, 'has an invalid number of factors');
  }
  const seen = new Set<string>();
  return items.map((item) => {
    if (typeof item !== 'string' || !isAllowed(item) || seen.has(item)) {
      return fail(status, field, 'contains an unsupported or duplicated factor');
    }
    seen.add(item);
    return item;
  });
}

function parseAccount(value: unknown, status: number): NativeAccountSummary {
  const account = requireObject(value, 'account', status);
  exactKeys(account, ['id', 'email', 'name'], 'account', status);
  return {
    id: boundedString(account.id, 'account.id', NATIVE_AUTH_LIMITS.ATTEMPT_ID, status),
    email: email(account.email, 'account.email', status),
    name: boundedString(account.name, 'account.name', NATIVE_AUTH_LIMITS.NAME, status),
  };
}

function parseApplication(value: unknown, status: number): NativeApplicationSummary {
  const application = requireObject(value, 'application', status);
  exactKeys(
    application,
    ['clientId', 'displayName', 'scopes', 'alreadyGranted'],
    'application',
    status,
  );
  return {
    clientId: boundedString(
      application.clientId,
      'application.clientId',
      NATIVE_AUTH_LIMITS.CLIENT_ID,
      status,
    ),
    displayName: boundedString(
      application.displayName,
      'application.displayName',
      NATIVE_AUTH_LIMITS.PROVIDER_NAME,
      status,
    ),
    scopes: boundedStringList(
      application.scopes,
      'application.scopes',
      NATIVE_AUTH_LIMITS.SCOPE,
      NATIVE_AUTH_LIMITS.SCOPE_COUNT,
      status,
    ),
    alreadyGranted: booleanValue(application.alreadyGranted, 'application.alreadyGranted', status),
  };
}

function optionalBoolean(record: JsonObject, key: string, status: number): boolean | undefined {
  return key in record ? booleanValue(record[key], key, status) : undefined;
}

export function parseAttemptResult(
  data: unknown,
  status: number,
  allowedExtras: readonly string[] = [],
): NativeAttemptResult {
  const record = requireObject(data, 'data', status);
  const attemptId = boundedString(
    record.attemptId,
    'attemptId',
    NATIVE_AUTH_LIMITS.ATTEMPT_ID,
    status,
  );
  const expiresAt = isoDate(record.expiresAt, 'expiresAt', status);
  const baseKeys = ['attemptId', 'stage', 'expiresAt'];
  const activationCompleted = optionalBoolean(record, 'activationCompleted', status);

  switch (record.stage) {
    case NATIVE_AUTH_STAGE.FIRST_FACTOR_REQUIRED: {
      exactKeys(record, [...baseKeys, 'factors', 'email', ...allowedExtras], 'data', status);
      const view: Extract<NativeAttemptView, { stage: 'firstFactorRequired' }> = {
        attemptId,
        stage: NATIVE_AUTH_STAGE.FIRST_FACTOR_REQUIRED,
        expiresAt,
        factors: parseFactors(record.factors, 'factors', isFirstFactor, { status, minimum: 0 }),
        ...(record.email === undefined ? {} : { email: email(record.email, 'email', status) }),
      };
      return view;
    }
    case NATIVE_AUTH_STAGE.EMAIL_LINK_SENT:
      exactKeys(record, [...baseKeys, 'email'], 'data', status);
      return {
        attemptId,
        stage: NATIVE_AUTH_STAGE.EMAIL_LINK_SENT,
        expiresAt,
        email: email(record.email, 'email', status),
      };
    case NATIVE_AUTH_STAGE.REGISTRATION_CODE_REQUIRED:
      exactKeys(
        record,
        [...baseKeys, 'email', 'activationCompleted', ...allowedExtras],
        'data',
        status,
      );
      return {
        attemptId,
        stage: NATIVE_AUTH_STAGE.REGISTRATION_CODE_REQUIRED,
        expiresAt,
        email: email(record.email, 'email', status),
        ...(activationCompleted === undefined ? {} : { activationCompleted }),
      };
    case NATIVE_AUTH_STAGE.RECOVERY_CODE_REQUIRED:
      exactKeys(record, [...baseKeys, 'email'], 'data', status);
      return {
        attemptId,
        stage: NATIVE_AUTH_STAGE.RECOVERY_CODE_REQUIRED,
        expiresAt,
        email: email(record.email, 'email', status),
      };
    case NATIVE_AUTH_STAGE.SECOND_FACTOR_REQUIRED:
      exactKeys(record, [...baseKeys, 'factors', 'activationCompleted'], 'data', status);
      return {
        attemptId,
        stage: NATIVE_AUTH_STAGE.SECOND_FACTOR_REQUIRED,
        expiresAt,
        factors: parseFactors(record.factors, 'factors', isSecondFactor, { status, minimum: 1 }),
        ...(activationCompleted === undefined ? {} : { activationCompleted }),
      };
    case NATIVE_AUTH_STAGE.CONSENT_REQUIRED:
      exactKeys(
        record,
        [...baseKeys, 'account', 'application', 'activationCompleted', ...allowedExtras],
        'data',
        status,
      );
      return {
        attemptId,
        stage: NATIVE_AUTH_STAGE.CONSENT_REQUIRED,
        expiresAt,
        account: parseAccount(record.account, status),
        application: parseApplication(record.application, status),
        ...(activationCompleted === undefined ? {} : { activationCompleted }),
      };
    case NATIVE_AUTH_STAGE.CODE_READY: {
      exactKeys(record, [...baseKeys, 'redirectUri', 'activationCompleted'], 'data', status);
      const codeReady: Extract<NativeAttemptView, { stage: 'codeReady' }> = {
        attemptId,
        stage: NATIVE_AUTH_STAGE.CODE_READY,
        expiresAt,
        redirectUri: boundedString(
          record.redirectUri,
          'redirectUri',
          NATIVE_AUTH_LIMITS.CALLBACK_URI,
          status,
        ),
        ...(activationCompleted === undefined ? {} : { activationCompleted }),
      };
      return codeReady;
    }
    case NATIVE_AUTH_STAGE.DENIED:
      exactKeys(record, [...baseKeys, 'reason'], 'data', status);
      if (record.reason !== undefined && record.reason !== 'cancelled') {
        fail(status, 'reason', 'is not supported');
      }
      return {
        attemptId,
        stage: NATIVE_AUTH_STAGE.DENIED,
        expiresAt,
        ...(record.reason === undefined ? {} : { reason: record.reason }),
      };
    case NATIVE_AUTH_STAGE.RECOVERY_COMPLETE:
      exactKeys(record, [...baseKeys, 'passwordUpdated'], 'data', status);
      if (record.passwordUpdated !== true) fail(status, 'passwordUpdated', 'is not true');
      return {
        attemptId,
        stage: NATIVE_AUTH_STAGE.RECOVERY_COMPLETE,
        expiresAt,
        passwordUpdated: true,
      };
    default:
      return fail(status, 'stage', 'is not supported');
  }
}

export function parseStartResult(data: unknown, status: number): NativeAttemptStartResult {
  const record = requireObject(data, 'data', status);
  if (record.stage !== NATIVE_AUTH_STAGE.FIRST_FACTOR_REQUIRED) {
    fail(status, 'stage', 'is not the initial stage');
  }
  const attemptSecret = boundedString(
    record.attemptSecret,
    'attemptSecret',
    NATIVE_AUTH_LIMITS.ATTEMPT_SECRET_LENGTH,
    status,
    NATIVE_AUTH_PATTERN.BASE64URL_SHA256,
  );
  const providerNonceDigest = boundedString(
    record.providerNonceDigest,
    'providerNonceDigest',
    NATIVE_AUTH_LIMITS.PROVIDER_NONCE_DIGEST_LENGTH,
    status,
    NATIVE_AUTH_PATTERN.SHA256_HEX,
  );
  const view = parseAttemptResult(data, status, ['attemptSecret', 'providerNonceDigest']);
  if (view.stage !== NATIVE_AUTH_STAGE.FIRST_FACTOR_REQUIRED) {
    fail(status, 'stage', 'is not the initial stage');
  }
  return { ...view, attemptSecret, providerNonceDigest };
}
