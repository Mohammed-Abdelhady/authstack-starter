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
  nearestFunction,
  ownerOf,
  walk,
} from './account-creation-inventory-nodes.harness-spec';
import { rawInsertMatcher } from './account-creation-inventory-raw.harness-spec';

function dominatingPolicy(
  policy: ts.CallExpression,
  insert: ts.CallExpression,
): boolean {
  if (!ts.isAwaitExpression(policy.parent)) return false;
  const statement = policy.parent.parent;
  if (!ts.isExpressionStatement(statement) || !ts.isBlock(statement.parent)) {
    return false;
  }
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
  const mutated = new Map(documents);
  mutated.set(
    file,
    text.slice(0, selected.getStart()) +
      replacement(selected.getText()) +
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
  let selected: ts.ExpressionStatement | undefined;
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      memberName(node.expression) === 'assertMayCreate' &&
      ts.isAwaitExpression(node.parent) &&
      ts.isExpressionStatement(node.parent.parent)
    ) {
      selected ??= node.parent.parent;
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
