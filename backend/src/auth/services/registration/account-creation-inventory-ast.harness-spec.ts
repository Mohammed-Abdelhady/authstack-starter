import ts from 'typescript';
import { verifyLedgerReservation } from './account-creation-inventory-ledger.harness-spec';
import {
  ACCOUNT_INSERT_METHODS,
  callerKey,
  expectedInventory,
  SEED_BOOTSTRAP_EXEMPTION,
} from './account-creation-inventory-expectations.harness-spec';
import {
  accessedMemberName,
  constantInitializers,
  indirectInsertReference,
  memberName,
  memberReceiver,
  nearestFunction,
  ownerOf,
  walk,
} from './account-creation-inventory-nodes.harness-spec';
import { rawInsertMatcher } from './account-creation-inventory-raw.harness-spec';

function policyStatement(
  policy: ts.CallExpression,
): ts.ExpressionStatement | ts.VariableStatement | undefined {
  if (!ts.isAwaitExpression(policy.parent)) return undefined;
  const parent = policy.parent.parent;
  if (ts.isExpressionStatement(parent)) return parent;
  if (
    ts.isVariableDeclaration(parent) &&
    ts.isVariableDeclarationList(parent.parent) &&
    ts.isVariableStatement(parent.parent.parent)
  ) {
    return parent.parent.parent;
  }
  return undefined;
}

function dominatingPolicy(
  policy: ts.CallExpression,
  insert: ts.CallExpression,
): boolean {
  const statement = policyStatement(policy);
  if (!statement || !ts.isBlock(statement.parent)) return false;
  const block = statement.parent;
  let insertStatement: ts.Node = insert;
  while (insertStatement.parent && insertStatement.parent !== block) {
    insertStatement = insertStatement.parent;
  }
  return (
    insertStatement.parent === block &&
    statement.getStart() < insertStatement.getStart()
  );
}

function verifyCaller(
  file: string,
  insert: ts.CallExpression,
  method: string,
  expected: ReturnType<typeof expectedInventory>['callers'][number] | undefined,
): string[] {
  const key = callerKey(file, ownerOf(insert), method);
  const body = nearestFunction(insert);
  if (!body) return [`${key}: no function body`];
  const unitOfWork = insert.arguments[0]?.getText();
  const policies: ts.CallExpression[] = [];
  walk(body.body, (node) => {
    if (
      ts.isCallExpression(node) &&
      memberName(node.expression) === 'assertMayCreate' &&
      nearestFunction(node) === body
    ) {
      policies.push(node);
    }
  });
  const errors: string[] = [];
  if (
    key !== SEED_BOOTSTRAP_EXEMPTION &&
    (policies.length !== 1 ||
      !policies.some(
        (policy) =>
          dominatingPolicy(policy, insert) &&
          policy.arguments[1]?.getText() === unitOfWork,
      ))
  ) {
    errors.push(
      `${key}: requires one earlier awaited policy with the insert UOW`,
    );
  }
  const parameter = body.parameters[0]?.name.getText();
  if (expected?.boundary === 'parameter') {
    if (!body.parameters.some((entry) => entry.name.getText() === unitOfWork)) {
      errors.push(`${key}: insert UOW is not a function parameter`);
    }
  } else if (expected) {
    const runner = body.parent;
    if (
      !ts.isCallExpression(runner) ||
      memberName(runner.expression) !== expected.boundary ||
      !ts.isPropertyAccessExpression(runner.expression) ||
      memberName(runner.expression.expression) !== 'runner' ||
      parameter !== unitOfWork ||
      runner.arguments[expected.boundary === 'run' ? 0 : 1] !== body
    ) {
      errors.push(`${key}: insert must use the runner callback UOW`);
    }
  }
  errors.push(...verifyLedgerReservation(key, insert));
  return errors;
}

function inventorySource(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const callers: { insert: ts.CallExpression; method: string }[] = [];
  const raw: string[] = [];
  const errors: string[] = [];
  const constants = constantInitializers(source);
  const rawInsertKind = rawInsertMatcher(source);
  walk(source, (node) => {
    const name = accessedMemberName(node, constants);
    if (ts.isElementAccessExpression(node)) {
      if (
        !name &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      ) {
        errors.push(
          `${file}: unresolved computed method may insert an account`,
        );
      }
    }
    const reference = indirectInsertReference(
      node,
      ACCOUNT_INSERT_METHODS,
      constants,
    );
    if (reference) {
      errors.push(
        `${callerKey(file, ownerOf(node), reference)}: insert method requires a direct call`,
      );
    }
    if (
      ts.isCallExpression(node) &&
      ACCOUNT_INSERT_METHODS.has(
        accessedMemberName(node.expression, constants) ?? '',
      )
    ) {
      callers.push({
        insert: node,
        method: accessedMemberName(node.expression, constants) ?? '',
      });
    }
    const kind = rawInsertKind(node);
    if (kind) raw.push(callerKey(file, ownerOf(node), kind));
  });
  return { callers, raw, errors };
}

export function scanAccountCreation(documents: ReadonlyMap<string, string>) {
  const expected = expectedInventory(new Set(documents.keys()));
  const callers: string[] = [];
  const raw: string[] = [];
  const errors: string[] = [];
  for (const [file, text] of documents) {
    const inventory = inventorySource(file, text);
    raw.push(...inventory.raw);
    errors.push(...inventory.errors);
    for (const { insert, method } of inventory.callers) {
      const owner = ownerOf(insert);
      callers.push(callerKey(file, owner, method));
      const contract = expected.callers.find(
        (entry) =>
          entry.file === file &&
          entry.owner === owner &&
          entry.method === method,
      );
      errors.push(...verifyCaller(file, insert, method, contract));
    }
  }
  const expectedCallers = expected.callers.map((entry) =>
    callerKey(entry.file, entry.owner, entry.method),
  );
  for (const [label, actual, wanted] of [
    ['callers', callers, expectedCallers],
    ['raw inserts', raw, expected.raw],
  ] as const) {
    if (
      JSON.stringify([...actual].sort()) !== JSON.stringify([...wanted].sort())
    ) {
      errors.push(
        `${label}: expected ${wanted.join(', ')}; found ${actual.join(', ')}`,
      );
    }
  }
  return { callers: callers.sort(), raw: raw.sort(), errors };
}

export function replaceInventoryCall(
  documents: ReadonlyMap<string, string>,
  file: string,
  method: string,
  replacement: (call: string) => string,
) {
  const text = documents.get(file);
  if (text === undefined) throw new Error(`Missing fixture source ${file}`);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let selected: ts.CallExpression | undefined;
  walk(source, (node) => {
    if (ts.isCallExpression(node) && memberName(node.expression) === method) {
      selected ??= node;
    }
  });
  if (!selected) throw new Error(`Missing fixture call ${file}#${method}`);
  const changed = replacement(selected.getText());
  if (changed === selected.getText())
    throw new Error(`Fixture mutation did not change ${file}#${method}`);
  const mutated = new Map(documents);
  mutated.set(
    file,
    text.slice(0, selected.getStart()) +
      changed +
      text.slice(selected.getEnd()),
  );
  return mutated;
}

export function moveInventoryPolicyToEnd(
  documents: ReadonlyMap<string, string>,
  file: string,
) {
  const text = documents.get(file);
  if (text === undefined) throw new Error(`Missing fixture source ${file}`);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let selected: ts.ExpressionStatement | ts.VariableStatement | undefined;
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      memberName(node.expression) === 'assertMayCreate'
    ) {
      selected ??= policyStatement(node);
    }
  });
  const body = selected && nearestFunction(selected);
  if (!selected || !body) throw new Error(`Missing fixture policy ${file}`);
  const insertion = body.body.getEnd() - 1;
  const mutated = new Map(documents);
  mutated.set(
    file,
    text.slice(0, selected.getStart()) +
      text.slice(selected.getEnd(), insertion) +
      selected.getText() +
      text.slice(insertion),
  );
  return mutated;
}

function mutationCall(call: string): ts.CallExpression {
  const source = ts.createSourceFile(
    'mutation.ts',
    call,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = source.statements[0];
  if (
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)
  )
    throw new Error('Fixture mutation requires a direct call');
  return statement.expression;
}

export function replaceInventoryArgument(index: number) {
  return (call: string): string => {
    const argument = mutationCall(call).arguments[index];
    if (!argument) throw new Error(`Fixture call has no argument ${index}`);
    return (
      call.slice(0, argument.getStart()) +
      'otherUnitOfWork' +
      call.slice(argument.getEnd())
    );
  };
}

export function replaceInventoryReceiver(call: string): string {
  const receiver = memberReceiver(mutationCall(call).expression);
  if (!receiver) throw new Error('Fixture call has no receiver');
  return (
    call.slice(0, receiver.getStart()) + 'store' + call.slice(receiver.getEnd())
  );
}
