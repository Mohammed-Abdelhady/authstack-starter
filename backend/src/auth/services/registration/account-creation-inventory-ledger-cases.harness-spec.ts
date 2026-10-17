import ts from 'typescript';
import { walk } from './account-creation-inventory-nodes.harness-spec';
import {
  replaceInventoryCall,
  replaceInventoryArgument,
  replaceInventoryReceiver,
  scanAccountCreation,
} from './account-creation-inventory-ast.harness-spec';
import { expectedInventory } from './account-creation-inventory-expectations.harness-spec';

function parameterInventoryCases(documents: ReadonlyMap<string, string>): void {
  it.each(
    expectedInventory(new Set(documents.keys())).callers.filter(
      (entry) => entry.boundary === 'parameter',
    ),
  )('requires a parameter-owned insert UOW in $file', ({ file, method }) => {
    const mutated = replaceInventoryCall(
      documents,
      file,
      method,
      replaceInventoryArgument(0),
    );
    expect(scanAccountCreation(mutated).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('insert UOW is not a function parameter'),
      ]),
    );
  });
}

function reservationInventoryCases(
  documents: ReadonlyMap<string, string>,
): void {
  it.each([
    {
      method: 'reserveForAccount',
      replace: () => 'Promise.resolve(null)',
      diagnostic: 'earlier awaited reserve',
    },
    {
      method: 'reserveForAccount',
      replace: replaceInventoryArgument(0),
      diagnostic: 'earlier awaited reserve',
    },
    {
      method: 'finishAccountReservation',
      replace: () => 'Promise.resolve()',
      diagnostic: 'awaited finish after insert',
    },
    {
      method: 'reserveForAccount',
      replace: (call: string) =>
        call.replace(/address:\s*[^,]+,/, 'address: otherEmail,'),
      diagnostic: 'reservation address must equal insert email',
    },
    ...['reserveForAccount', 'finishAccountReservation'].map((method) => ({
      method,
      replace: replaceInventoryReceiver,
      diagnostic: 'require a ledger receiver',
    })),
    ...['return', 'throw new Error()'].map((exit) => ({
      method: 'finishAccountReservation',
      replace: (call: string) => `Promise.resolve(); ${exit}; await ${call}`,
      diagnostic: 'return or throw between insert and finish',
    })),
  ])(
    'rejects a broken ledger handoff: $method $diagnostic',
    ({ method, replace, diagnostic }) => {
      for (const { file } of expectedInventory(new Set(documents.keys()))
        .callers) {
        const mutated = replaceInventoryCall(documents, file, method, replace);
        expect(scanAccountCreation(mutated).errors).toEqual(
          expect.arrayContaining([expect.stringContaining(diagnostic)]),
        );
      }
    },
  );
}

function skippedLedgerCases(documents: ReadonlyMap<string, string>): void {
  it.each(['refusal', 'cleanup'] as const)(
    'rejects a skipped ledger %s',
    (piece) => {
      for (const { file } of expectedInventory(new Set(documents.keys()))
        .callers) {
        const text = documents.get(file);
        if (text === undefined)
          throw new Error(`Missing fixture source ${file}`);
        const source = ts.createSourceFile(
          file,
          text,
          ts.ScriptTarget.Latest,
          true,
        );
        let selected: ts.Node | undefined;
        walk(source, (node) => {
          if (
            piece === 'refusal' &&
            ts.isIfStatement(node) &&
            node.expression.getText() ===
              'reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN'
          ) {
            selected ??= node;
          }
          if (
            piece === 'cleanup' &&
            ts.isExpressionStatement(node) &&
            ts.isAwaitExpression(node.expression) &&
            ts.isCallExpression(node.expression.expression) &&
            ts.isPropertyAccessExpression(
              node.expression.expression.expression,
            ) &&
            node.expression.expression.expression.name.text ===
              'finishAccountReservation'
          ) {
            selected ??= node;
          }
        });
        if (!selected) throw new Error(`Missing fixture ${piece} ${file}`);
        const mutated = new Map(documents);
        mutated.set(
          file,
          text.slice(0, selected.getStart()) +
            (piece === 'cleanup'
              ? `if (false) { ${selected.getText()} }`
              : '') +
            text.slice(selected.getEnd()),
        );
        expect(scanAccountCreation(mutated).errors).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              piece === 'refusal'
                ? 'taken reservation to throw'
                : 'awaited finish after insert',
            ),
          ]),
        );
      }
    },
  );
}

export function ledgerInventoryCases(
  documents: ReadonlyMap<string, string>,
): void {
  parameterInventoryCases(documents);
  reservationInventoryCases(documents);
  skippedLedgerCases(documents);
}
