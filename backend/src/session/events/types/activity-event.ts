export type SecurityEventKind = 'staff' | 'sign_in';

export type ActivityDetails = Record<
  string,
  string | number | boolean | string[]
>;

export interface ActivityEventFields {
  kind?: SecurityEventKind;
  details?: ActivityDetails;
  purgeAfter?: Date;
}

export interface ActivityQuery {
  actor?: string;
  action?: string;
  target?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}
