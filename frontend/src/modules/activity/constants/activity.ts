import { ACTIVITY_PERMISSIONS } from '@app/core';

export const ACTIVITY_READ_PERMISSION = ACTIVITY_PERMISSIONS.READ_ALL;
export const ACTIVITY_PAGE_LIMIT = 10;
export const ACTIVITY_FILTER_FIELDS = ['actor', 'action', 'target', 'from', 'to'] as const;
export const ACTIVITY_MAX_OFFSET = 10_000;
export const ACTIVITY_MAX_FILTER_LENGTH = 200;
// Mirrors backend/src/session/events/constants/activity-details.ts ACTIVITY_FILTER_PATTERN.
export const ACTIVITY_FILTER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
export const ACTIVITY_BAD_REQUEST_STATUS = 400;
