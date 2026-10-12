import 'reflect-metadata';
import { Transform } from 'class-transformer'; // feature:postgres,database-choice
import {
  IsIn, // feature:database-choice
  IsInt, // feature:postgres
  IsNotEmpty,
  IsOptional, // feature:postgres,database-choice
  IsString,
  Matches,
  Max, // feature:postgres
  Min, // feature:postgres
  ValidateIf, // feature:database-choice
} from 'class-validator';
// feature:database-choice:start
import {
  DEFAULT_STORAGE_KIND,
  STORAGE_KIND,
  STORAGE_KINDS,
  StorageKind,
} from '../common/persistence/storage-choice';
import { transformOptionalString } from '../common/utils/environment-transform';
// feature:database-choice:end

// feature:postgres:start
export const POSTGRES_POOL_MAX_DEFAULT = 10;

/** What a missing address is told. */
export const POSTGRES_URL_REQUIRED =
  'POSTGRES_URL is required when DATABASE_TYPE is postgres';

/**
 * A number setting left blank in a copied example file is unset, as blank text
 * settings are. Anything else is read as a number and validated as one.
 */
function blankAsDefault(
  fallback: number,
): (params: { value: unknown }) => unknown {
  return ({ value }) =>
    value === undefined || value === null || value === ''
      ? fallback
      : Number(value);
}
// feature:postgres:end

// feature:database-choice:start
/** True when the setting, as given or defaulted, names this database. */
export function runsOn(kind: StorageKind): (environment: object) => boolean {
  return (environment) =>
    (Reflect.get(environment, 'DATABASE_TYPE') ?? DEFAULT_STORAGE_KIND) ===
    kind;
}
// feature:database-choice:end

/** How the server reaches its database. */
export class StorageEnvironmentVariables {
  // feature:database-choice:start
  /** Which database the server runs on. The other one's settings are not read. */
  @Transform(transformOptionalString)
  @IsIn([...STORAGE_KINDS])
  @IsOptional()
  DATABASE_TYPE: StorageKind = DEFAULT_STORAGE_KIND;

  // feature:database-choice:end
  // feature:mongodb:start
  @ValidateIf(runsOn(STORAGE_KIND.MONGODB)) // feature:database-choice
  @IsString()
  @IsNotEmpty()
  @Matches(/^mongodb(\+srv)?:\/\/.+$/, {
    message:
      'MONGO_URI must be a valid MongoDB connection string starting with mongodb:// or mongodb+srv://',
  })
  MONGO_URI!: string;
  // feature:mongodb:end
  // feature:postgres:start

  @ValidateIf(runsOn(STORAGE_KIND.POSTGRES)) // feature:database-choice
  @IsString()
  @IsNotEmpty({ message: POSTGRES_URL_REQUIRED })
  @Matches(/^postgres(ql)?:\/\/.+$/, {
    message:
      'POSTGRES_URL must be a PostgreSQL connection string starting with postgres:// or postgresql://',
  })
  POSTGRES_URL?: string;

  /** Connections the server may hold open at once. */
  @ValidateIf(runsOn(STORAGE_KIND.POSTGRES)) // feature:database-choice
  @Transform(blankAsDefault(POSTGRES_POOL_MAX_DEFAULT))
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  POSTGRES_POOL_MAX: number = POSTGRES_POOL_MAX_DEFAULT;
  // feature:postgres:end
}
