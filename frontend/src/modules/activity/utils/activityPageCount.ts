import { ACTIVITY_MAX_OFFSET } from '../constants/activity';

export function activityPageCount(totalPages: number, limit: number): number {
  return Math.max(1, Math.min(totalPages, Math.floor(ACTIVITY_MAX_OFFSET / limit) + 1));
}
