import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_URL = new URL(
  existsSync(new URL('../frontend/package.json', import.meta.url))
    ? '../frontend/package.json'
    : '../backend/package.json',
  import.meta.url,
);
const REQUIRE = createRequire(PACKAGE_URL);
const TS = REQUIRE('typescript');
const SOURCE_ROOT = 'frontend/src';
const USER_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'title',
  'placeholder',
  'alt',
  'label',
  'description',
  'subtitle',
  'loadingText',
  'emptyMessage',
]);
const CODE_ELEMENTS = new Set(['code', 'pre', 'CodeBlock']);
const EXCLUDED_DIRECTORIES = new Set(['__tests__', 'tests', 'node_modules', '.next']);

export function hardcodedStringViolations(source, file = 'component.tsx') {
  const tree = TS.createSourceFile(file, source, TS.ScriptTarget.Latest, true, TS.ScriptKind.TSX);
  const violations = [];
  const report = (node, kind) => {
    const text = node.text.trim();
    if (!text || (kind !== 'attribute' && !/[\p{L}\p{N}]/u.test(text))) return;
    violations.push({
      file,
      line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
      kind,
    });
  };
  const inspectExpression = (node, kind) => {
    if (TS.isStringLiteral(node) || TS.isNoSubstitutionTemplateLiteral(node)) report(node, kind);
    else if (TS.isTemplateExpression(node)) {
      report(node.head, kind);
      for (const span of node.templateSpans) {
        inspectExpression(span.expression, kind);
        report(span.literal, kind);
      }
    } else if (TS.isConditionalExpression(node)) {
      inspectExpression(node.whenTrue, kind);
      inspectExpression(node.whenFalse, kind);
    } else if (TS.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        [
          TS.SyntaxKind.BarBarToken,
          TS.SyntaxKind.QuestionQuestionToken,
          TS.SyntaxKind.PlusToken,
        ].includes(operator)
      ) {
        inspectExpression(node.left, kind);
        inspectExpression(node.right, kind);
      } else if (operator === TS.SyntaxKind.AmpersandAmpersandToken)
        inspectExpression(node.right, kind);
    } else if (TS.isParenthesizedExpression(node)) inspectExpression(node.expression, kind);
  };
  const visit = (node, inCode = false) => {
    if (TS.isJsxElement(node)) {
      const code = inCode || CODE_ELEMENTS.has(node.openingElement.tagName.getText(tree));
      visit(node.openingElement, inCode);
      for (const child of node.children) visit(child, code);
      return;
    }
    if (TS.isJsxAttribute(node) && USER_ATTRIBUTES.has(node.name.getText(tree))) {
      if (node.initializer && TS.isStringLiteral(node.initializer))
        report(node.initializer, 'attribute');
      else if (
        node.initializer &&
        TS.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        inspectExpression(node.initializer.expression, 'attribute');
      }
    }
    if (!inCode && TS.isJsxText(node)) report(node, 'text');
    if (
      !inCode &&
      TS.isJsxExpression(node) &&
      node.expression &&
      (TS.isJsxElement(node.parent) || TS.isJsxFragment(node.parent))
    ) {
      inspectExpression(node.expression, 'expression');
    }
    TS.forEachChild(node, (child) => visit(child, inCode));
  };
  visit(tree);
  return violations;
}

export function scanHardcodedStrings(root) {
  const directory = join(root, SOURCE_ROOT);
  if (!existsSync(directory)) return [];
  const scan = (folder) =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : scan(path);
      if (!entry.name.endsWith('.tsx') || /\.(test|spec)\.tsx$/.test(entry.name)) return [];
      return hardcodedStringViolations(readFileSync(path, 'utf8'), relative(root, path));
    });
  return scan(directory).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const violations = scanHardcodedStrings(root);
  for (const { file, line, kind } of violations)
    console.error(`${file}:${line}: hardcoded UI ${kind}`);
  process.exitCode = violations.length ? 1 : 0;
}
