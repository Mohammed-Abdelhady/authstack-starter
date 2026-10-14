import ts from 'typescript';

export type FunctionBody = ts.FunctionLikeDeclaration & { body: ts.Block };

export function isFunctionBody(node: ts.Node): node is FunctionBody {
  return (
    (ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)) &&
    node.body !== undefined &&
    ts.isBlock(node.body)
  );
}

export function nearestFunction(node: ts.Node): FunctionBody | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunctionBody(parent)) return parent;
  }
  return undefined;
}

export function ownerOf(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunctionBody(parent) && parent.name) return parent.name.getText();
  }
  return '<anonymous>';
}

export function memberName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

export function memberReceiver(node: ts.Node): ts.Expression | undefined {
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    return node.expression;
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const declaration = node.parent.parent;
    if (ts.isVariableDeclaration(declaration)) return declaration.initializer;
  }
  return undefined;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

export function bindingCounts(source: ts.SourceFile) {
  const counts = new Map<string, number>();
  walk(source, (node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name)
    ) {
      counts.set(node.name.text, (counts.get(node.name.text) ?? 0) + 1);
    }
  });
  return counts;
}

export function constantInitializers(source: ts.SourceFile) {
  const constants = new Map<string, ts.Expression>();
  const counts = bindingCounts(source);
  walk(source, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      counts.get(node.name.text) === 1 &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      constants.set(node.name.text, unwrap(node.initializer));
    }
  });
  return constants;
}

export function resolvedExpression(
  expression: ts.Expression,
  constants: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
): ts.Expression {
  const value = unwrap(expression);
  if (!ts.isIdentifier(value) || seen.has(value.text)) return value;
  const initializer = constants.get(value.text);
  if (!initializer) return value;
  seen.add(value.text);
  return resolvedExpression(initializer, constants, seen);
}

export function accessedMemberName(
  node: ts.Node,
  constants: ReadonlyMap<string, ts.Expression>,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    const value = resolvedExpression(node.argumentExpression, constants);
    return ts.isStringLiteral(value) ? value.text : undefined;
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const property = node.propertyName ?? node.name;
    const value = ts.isComputedPropertyName(property)
      ? resolvedExpression(property.expression, constants)
      : property;
    if (ts.isIdentifier(value) || ts.isStringLiteral(value)) return value.text;
  }
  return undefined;
}

/** A method handed off as a value has no call this scan can follow. */
export function indirectInsertReference(
  node: ts.Node,
  methods: ReadonlySet<string>,
  constants: ReadonlyMap<string, ts.Expression>,
): string | undefined {
  const name = accessedMemberName(node, constants);
  if (!name || !methods.has(name)) return undefined;
  if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
    return undefined;
  }
  return name;
}
