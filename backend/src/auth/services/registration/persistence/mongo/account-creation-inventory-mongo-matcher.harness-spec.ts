import ts from 'typescript';
import {
  accessedMemberName,
  bindingCounts,
  constantInitializers,
  FunctionBody,
  indirectInsertReference,
  isFunctionBody,
  memberName,
  memberReceiver,
  nearestFunction,
  resolvedExpression,
  unwrap,
  walk,
} from '../../account-creation-inventory-nodes.harness-spec';

const CREATE_METHODS = new Set([
  'create',
  'insertMany',
  'insertOne',
  'bulkWrite',
]);
const UPSERT_METHODS = new Set([
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
]);
const INSERT_METHODS = new Set([...CREATE_METHODS, ...UPSERT_METHODS, 'save']);

function modelDeclarations(source: ts.SourceFile) {
  const users = new Set<string>(['userModel']);
  const others = new Set<string>();
  const otherParameters = new Set<string>();
  const counts = bindingCounts(source);
  let userModelFile = false;
  walk(source, (node) => {
    if (
      (ts.isParameter(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertySignature(node)) &&
      node.type &&
      ts.isTypeReferenceNode(node.type) &&
      node.type.typeName.getText() === 'Model'
    ) {
      if (
        node.type.typeArguments?.some(
          (type) => type.getText() === 'UserDocument',
        )
      ) {
        users.add(node.name.getText());
        userModelFile = true;
      } else if (
        node.type.typeArguments?.length === 1 &&
        ts.isTypeReferenceNode(node.type.typeArguments[0]) &&
        ts.isIdentifier(node.type.typeArguments[0].typeName) &&
        node.type.typeArguments[0].typeName.text.endsWith('Document')
      ) {
        others.add(node.name.getText());
        if (ts.isParameter(node) && counts.get(node.name.getText()) === 1) {
          otherParameters.add(node.name.getText());
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'userModel') {
      userModelFile = true;
    }
  });
  return { users, others, otherParameters, userModelFile };
}

function receiverName(expression: ts.Expression): string | undefined {
  const value = unwrap(expression);
  if (memberName(value) === 'collection') {
    const receiver = memberReceiver(value);
    return receiver && receiverName(receiver);
  }
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value)) {
    return value.expression.kind === ts.SyntaxKind.ThisKeyword
      ? value.name.text
      : undefined;
  }
  if (
    ts.isElementAccessExpression(value) &&
    value.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return memberName(value);
  }
  return undefined;
}

/** An options variable can change after its initializer was read. */
function mayUpsert(expression: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expression)) return true;
  return expression.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) return true;
    const name = property.name;
    if (!name) return false;
    if (ts.isComputedPropertyName(name)) return true;
    if (
      !(ts.isIdentifier(name) || ts.isStringLiteral(name)) ||
      name.text !== 'upsert'
    ) {
      return false;
    }
    return (
      !ts.isPropertyAssignment(property) ||
      property.initializer.kind !== ts.SyntaxKind.FalseKeyword
    );
  });
}

/** Unknown write receivers fail closed because this scan does not type-check. */
export function mongoAccountInsertMatcher(source: ts.SourceFile) {
  const { users, others, otherParameters, userModelFile } =
    modelDeclarations(source);
  const constants = constantInitializers(source);
  const constructed = new Map<FunctionBody, Set<string>>();
  walk(source, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !node.initializer ||
      !ts.isNewExpression(node.initializer) ||
      !users.has(receiverName(node.initializer.expression) ?? '')
    ) {
      return;
    }
    const body = nearestFunction(node);
    if (!body) return;
    const names = constructed.get(body) ?? new Set<string>();
    names.add(node.name.getText());
    constructed.set(body, names);
  });
  const isNewDocument = (node: ts.Node, receiver?: ts.Expression) => {
    const value = receiver && unwrap(receiver);
    if (!value || !ts.isIdentifier(value)) return false;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (isFunctionBody(parent) && constructed.get(parent)?.has(value.text)) {
        return true;
      }
    }
    return false;
  };
  return (node: ts.Node): string | undefined => {
    const reference = indirectInsertReference(node, INSERT_METHODS, constants);
    if (reference) {
      const receiver = memberReceiver(node);
      const name = receiver && receiverName(receiver);
      const knownOther =
        receiver && ts.isIdentifier(unwrap(receiver))
          ? otherParameters.has(name ?? '')
          : others.has(name ?? '');
      const inserts =
        reference === 'save'
          ? isNewDocument(node, receiver)
          : users.has(name ?? '') || (userModelFile && !knownOther);
      if (inserts) return 'insert method requires a direct call';
    }
    if (ts.isBindingElement(node) && node.propertyName) {
      const property = ts.isComputedPropertyName(node.propertyName)
        ? resolvedExpression(node.propertyName.expression, constants)
        : node.propertyName;
      if (
        (ts.isIdentifier(property) || ts.isStringLiteral(property)) &&
        users.has(property.text) &&
        node.name.getText() !== property.text
      ) {
        return 'unfollowed user-model alias';
      }
    }
    const alias = ts.isVariableDeclaration(node)
      ? node.initializer
      : ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? node.right
        : undefined;
    if (alias && users.has(receiverName(alias) ?? '')) {
      return 'unfollowed user-model alias';
    }
    if (
      ts.isNewExpression(node) &&
      users.has(receiverName(node.expression) ?? '')
    ) {
      return 'construct';
    }
    if (!ts.isCallExpression(node)) return undefined;
    const method = ts.isIdentifier(node.expression)
      ? node.expression.text
      : accessedMemberName(node.expression, constants);
    const receiver = memberReceiver(node.expression);
    if (!receiver) {
      return userModelFile && CREATE_METHODS.has(method ?? '')
        ? 'unresolved user-model write receiver'
        : undefined;
    }
    const name = receiverName(receiver);
    const knownOther = ts.isIdentifier(unwrap(receiver))
      ? otherParameters.has(name ?? '')
      : others.has(name ?? '');
    const creates = CREATE_METHODS.has(method ?? '');
    const upserts =
      UPSERT_METHODS.has(method ?? '') &&
      node.arguments[2] !== undefined &&
      mayUpsert(node.arguments[2]);
    if (creates || upserts) {
      if (users.has(name ?? '')) return method;
      if (userModelFile && !knownOther) {
        return 'unresolved user-model write receiver';
      }
    }
    return method === 'save' && isNewDocument(node, receiver)
      ? 'save'
      : undefined;
  };
}
