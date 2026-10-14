import ts from 'typescript';
import { mongoAccountInsertMatcher } from './persistence/mongo/account-creation-inventory-mongo-matcher.harness-spec'; // feature:mongodb
import { postgresAccountInsertMatcher } from './persistence/postgres/account-creation-inventory-postgres-matcher.harness-spec'; // feature:postgres

export function rawInsertMatcher(source: ts.SourceFile) {
  const matchers = [
    mongoAccountInsertMatcher(source), // feature:mongodb
    postgresAccountInsertMatcher(source), // feature:postgres
  ];
  return (node: ts.Node): string | undefined => {
    for (const matcher of matchers) {
      const kind = matcher(node);
      if (kind) return kind;
    }
    return undefined;
  };
}
