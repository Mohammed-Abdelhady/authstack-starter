import { DEFAULT_SELECTION, describeDatabaseProjects, POSTGRES_BUDGET } from './database-cases.js';

describeDatabaseProjects('generated PostgreSQL projects', [
  {
    name: 'PostgreSQL with every sign-in method',
    database: 'postgres',
    features: undefined,
    ...POSTGRES_BUDGET,
  },
  {
    name: 'PostgreSQL with the default selection',
    database: 'postgres',
    features: DEFAULT_SELECTION,
    ...POSTGRES_BUDGET,
  },
  {
    name: 'PostgreSQL with every optional method left out',
    database: 'postgres',
    features: ['email-password'],
    ...POSTGRES_BUDGET,
  },
  {
    name: 'PostgreSQL with two-factor, passkeys and one provider, without magic link',
    database: 'postgres',
    features: ['email-password', 'totp', 'passkeys', 'github'],
    ...POSTGRES_BUDGET,
  },
  {
    name: 'PostgreSQL without email and password',
    database: 'postgres',
    features: ['magic-link', 'passkeys', 'google'],
    ...POSTGRES_BUDGET,
  },
  {
    name: 'PostgreSQL web and Expo with Apple, without email and password',
    database: 'postgres',
    features: ['magic-link', 'passkeys', 'google', 'apple'],
    flags: ['--targets', 'web,native-expo', '--locales', 'en,ar'],
    ...POSTGRES_BUDGET,
  },
  {
    name: 'PostgreSQL with one provider and no first-party sign-in',
    database: 'postgres',
    features: ['github'],
    ...POSTGRES_BUDGET,
  },
]);
