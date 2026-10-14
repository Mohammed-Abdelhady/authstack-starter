export interface MigrationSource {
  id: 'core' | 'host';
  directory: string;
  ledger: 'schema_migrations' | 'host_migrations';
  lockKey: number;
}

export interface MigrationSources {
  core: MigrationSource;
  host: MigrationSource;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  unknown: string[];
}

export interface ListedMigrationSource {
  source: MigrationSource;
  files: string[];
}

export interface SourceMigrationStatus extends MigrationStatus {
  source: MigrationSource;
}

export interface MigrateOptions {
  names?: string[];
  sources?: MigrationSources;
}
