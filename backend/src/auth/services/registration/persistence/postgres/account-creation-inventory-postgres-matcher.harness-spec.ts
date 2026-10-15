import ts from 'typescript';
import {
  accessedMemberName,
  constantInitializers,
  indirectInsertReference,
} from '../../account-creation-inventory-nodes.harness-spec';

const INSERT_METHODS = new Set(['insertInto']);

/** A computed table cannot be proved to avoid account creation. */
export function postgresAccountInsertMatcher(source: ts.SourceFile) {
  const constants = constantInitializers(source);
  return (node: ts.Node): string | undefined => {
    if (indirectInsertReference(node, INSERT_METHODS, constants)) {
      return 'insert method requires a direct call';
    }
    if (!ts.isCallExpression(node)) return undefined;
    const method = ts.isIdentifier(node.expression)
      ? node.expression.text
      : accessedMemberName(node.expression, constants);
    if (method !== 'insertInto') return undefined;
    const table = node.arguments[0];
    if (!table || !ts.isStringLiteral(table)) {
      return 'unresolved insertInto table';
    }
    return table.text === 'users' ? 'postgres' : undefined;
  };
}
