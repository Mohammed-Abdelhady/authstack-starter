import { posix } from 'node:path';
import ts from 'typescript';

const BOOT_ROOTS = ['backend/test/utils/e2e-app', 'backend/test/utils/session-authority-harness'];
const SPEC = /\.spec\.ts$/;

function modulePath(file: string): string {
  return file.replace(/\.(?:js|ts)$/, '');
}

function imports(file: string, source: string): string[] {
  const targets: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  function visit(node: ts.Node): void {
    let specifier: ts.Node | undefined;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyNamedTypes =
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly);
      if (clause?.isTypeOnly || (!clause?.name && onlyNamedTypes)) return;
      specifier = node.moduleSpecifier;
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const onlyNamedTypes =
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly);
      if (node.isTypeOnly || onlyNamedTypes) return;
      specifier = node.moduleSpecifier;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteral(specifier)) {
      const target = specifier.text.startsWith('.')
        ? posix.join(posix.dirname(file), specifier.text)
        : `backend/${specifier.text}`;
      targets.push(modulePath(target));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return targets;
}

export function discoverBootingSpecs(sources: Readonly<Record<string, string>>): string[] {
  const dependencies = Object.entries(sources).map(([file, source]) => ({
    file,
    targets: imports(file, source),
  }));
  const booting = new Set(BOOT_ROOTS);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { file, targets } of dependencies) {
      const path = modulePath(file);
      if (
        booting.has(path) ||
        (!file.startsWith('backend/test/') && (!file.startsWith('backend/src/') || SPEC.test(file)))
      )
        continue;
      if (!targets.some((target) => booting.has(target))) continue;
      booting.add(path);
      grew = true;
    }
  }
  return dependencies
    .filter(
      ({ file, targets }) =>
        file.startsWith('backend/src/') &&
        SPEC.test(file) &&
        targets.some((target) => booting.has(target)),
    )
    .map(({ file }) => file);
}
