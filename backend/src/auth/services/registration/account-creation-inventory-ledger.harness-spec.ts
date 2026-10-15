import ts from 'typescript';
import {
  memberName,
  memberReceiver,
  nearestFunction,
  walk,
} from './account-creation-inventory-nodes.harness-spec';

function inputField(call: ts.CallExpression, name: string): string | undefined {
  const input = call.arguments[1];
  if (!input || !ts.isObjectLiteralExpression(input)) return undefined;
  for (const property of input.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property.initializer.getText();
    }
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === name
    ) {
      return property.name.text;
    }
  }
  return undefined;
}

/** Checks transaction ownership and ordering independently of the policy exemption. */
export function verifyLedgerReservation(
  key: string,
  insert: ts.CallExpression,
): string[] {
  const body = nearestFunction(insert);
  if (!body) return [`${key}: no function body`];
  const uow = insert.arguments[0]?.getText();
  const reserves: ts.CallExpression[] = [];
  const finishes: ts.CallExpression[] = [];
  walk(body.body, (node) => {
    if (!ts.isCallExpression(node) || nearestFunction(node) !== body) return;
    const name = memberName(node.expression);
    if (name === 'reserveForAccount') reserves.push(node);
    if (name === 'finishAccountReservation') finishes.push(node);
  });
  const errors: string[] = [];
  const reserve = reserves[0];
  if (
    [...reserves, ...finishes].some(
      (call) => !memberReceiver(call.expression)?.getText().endsWith('ledger'),
    )
  ) {
    errors.push(`${key}: reserve and finish require a ledger receiver`);
  }
  if (
    reserve &&
    (inputField(reserve, 'address') === undefined ||
      inputField(reserve, 'address') !== inputField(insert, 'email'))
  ) {
    errors.push(`${key}: reservation address must equal insert email`);
  }
  const awaited =
    reserve && ts.isAwaitExpression(reserve.parent)
      ? reserve.parent
      : undefined;
  const variable =
    awaited && ts.isVariableDeclaration(awaited.parent)
      ? awaited.parent
      : undefined;
  const statement = variable?.parent.parent;
  let insertStatement: ts.Node = insert;
  while (insertStatement.parent && insertStatement.parent !== body.body) {
    insertStatement = insertStatement.parent;
  }
  if (
    reserves.length !== 1 ||
    !reserve ||
    !variable ||
    !statement ||
    !ts.isVariableStatement(statement) ||
    statement.parent !== body.body ||
    statement.getStart() >= insertStatement.getStart() ||
    reserve.arguments[0]?.getText() !== uow
  ) {
    errors.push(
      `${key}: requires one earlier awaited reserve with the insert UOW`,
    );
  }
  if (
    !variable ||
    !body.body.statements.some(
      (entry) =>
        ts.isIfStatement(entry) &&
        entry.getStart() > (statement?.getEnd() ?? Infinity) &&
        entry.getEnd() < insertStatement.getStart() &&
        ts.isBinaryExpression(entry.expression) &&
        entry.expression.operatorToken.kind ===
          ts.SyntaxKind.EqualsEqualsEqualsToken &&
        entry.expression.left.getText() ===
          `${variable.name.getText()}.status` &&
        entry.expression.right.getText() ===
          'ACCOUNT_RESERVATION_RESULT.TAKEN' &&
        (ts.isThrowStatement(entry.thenStatement) ||
          (ts.isBlock(entry.thenStatement) &&
            entry.thenStatement.statements.length === 1 &&
            entry.thenStatement.statements.every((node) =>
              ts.isThrowStatement(node),
            ))),
    )
  ) {
    errors.push(`${key}: requires a taken reservation to throw before insert`);
  }
  let insertInBlock: ts.Node = insert;
  while (insertInBlock.parent && !ts.isBlock(insertInBlock.parent)) {
    insertInBlock = insertInBlock.parent;
  }
  if (
    finishes.length !== 1 ||
    !variable ||
    !finishes.some(
      (finish) =>
        ts.isAwaitExpression(finish.parent) &&
        ts.isExpressionStatement(finish.parent.parent) &&
        finish.parent.parent.parent === insertInBlock.parent &&
        finish.getStart() > insert.getEnd() &&
        finish.arguments[0]?.getText() === uow &&
        finish.arguments[1]?.getText() ===
          `${variable.name.getText()}.reservation`,
    )
  ) {
    errors.push(
      `${key}: requires awaited finish after insert with the same UOW and reservation`,
    );
  }
  const finish = finishes[0];
  if (finish) {
    walk(body.body, (node) => {
      if (
        (ts.isReturnStatement(node) || ts.isThrowStatement(node)) &&
        nearestFunction(node) === body &&
        node.getStart() > insert.getEnd() &&
        node.getStart() < finish.getStart()
      ) {
        errors.push(`${key}: return or throw between insert and finish`);
      }
    });
  }
  return errors;
}
