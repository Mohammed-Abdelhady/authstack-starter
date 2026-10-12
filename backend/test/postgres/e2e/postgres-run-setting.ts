/**
 * Loaded first in every suite of the PostgreSQL run, before any file that
 * picks an adapter. The application reads the database from this setting, the
 * way an installation does.
 */
process.env.DATABASE_TYPE = 'postgres';
