export interface LinkHostManifest {
  readonly host: string | undefined;
  readonly paths: readonly string[];
  readonly apiPrefix: string;
  readonly reservedPathPrefixes: readonly string[];
  readonly associationPaths: readonly string[];
  readonly acmeChallengePrefix: string;
}
