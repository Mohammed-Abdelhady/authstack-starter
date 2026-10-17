import { resolve } from 'node:path';

function exported(ts, statement) {
  return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function validAudience(ts, statement) {
  return (
    statement &&
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length === 1 &&
    statement.declarationList.declarations[0]?.name.getText() === 'ROLE_AUDIENCE'
  );
}

function validRoleAudience(ts, statement) {
  return (
    statement && ts.isTypeAliasDeclaration(statement) && statement.name.text === 'RoleAudience'
  );
}

function validHostRole(ts, statement) {
  return statement && ts.isInterfaceDeclaration(statement) && statement.name.text === 'HostRole';
}

function hasDependencies(ts, file) {
  let dependent = false;
  function visit(node) {
    if (
      ts.isImportTypeNode(node) ||
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportDeclaration(node)
    )
      dependent = true;
    ts.forEachChild(node, visit);
  }
  visit(file);
  return dependent;
}

export function assertSelfContainedContract(ts, source) {
  const file = ts.createSourceFile('host-role.type.ts', source, ts.ScriptTarget.ES2022, true);
  if (
    file.referencedFiles.length ||
    file.typeReferenceDirectives.length ||
    file.libReferenceDirectives.length
  )
    throw new Error('Host role contract must be self-contained, without reference dependencies');
  const statements = file.statements;
  if (
    hasDependencies(ts, file) ||
    statements.length !== 3 ||
    !validAudience(ts, statements[0]) ||
    !validRoleAudience(ts, statements[1]) ||
    !validHostRole(ts, statements[2]) ||
    !statements.every((statement) => exported(ts, statement))
  )
    throw new Error(
      'Host role contract must export only self-contained ROLE_AUDIENCE, RoleAudience and HostRole',
    );
}

function primitive(value) {
  if (value === null) return true;
  if (['string', 'boolean'].includes(typeof value)) return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function assertPlainContainer(value) {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new Error('Host access exports must contain plain data');
  if (Object.getOwnPropertySymbols(value).length)
    throw new Error('Host access exports cannot contain symbol fields');
}

function serializable(value, ancestors = new Set()) {
  if (primitive(value)) return;
  if (typeof value !== 'object' || ancestors.has(value))
    throw new Error('Host access exports contain an unserializable value');
  assertPlainContainer(value);
  ancestors.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get || descriptor.set)
      throw new Error('Host access exports cannot contain accessors');
    if (descriptor.enumerable) serializable(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

export function candidateSource(contract, values) {
  if (!Array.isArray(values.HOST_PERMISSIONS) || !Array.isArray(values.HOST_ROLES))
    throw new Error('Host module must export HOST_PERMISSIONS and HOST_ROLES arrays');
  serializable(values.HOST_PERMISSIONS);
  serializable(values.HOST_ROLES);
  return `${contract.trimEnd()}\n\nexport const HOST_PERMISSIONS: readonly string[] = ${JSON.stringify(values.HOST_PERMISSIONS, null, 2)};\n\nexport const HOST_ROLES: readonly HostRole[] = ${JSON.stringify(values.HOST_ROLES, null, 2)};\n`;
}

export function assertCandidateTypes(ts, source, output) {
  const path = resolve(output);
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    types: [],
    lib: ['lib.es2022.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.getSourceFile.bind(host);
  host.getSourceFile = (...args) => {
    const [name, version] = args;
    return resolve(name) === path
      ? ts.createSourceFile(name, source, version, true)
      : originalRead(...args);
  };
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([path], options, host));
  if (diagnostics.length) {
    const details = diagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n');
    throw new Error(`Host access candidate failed type validation:\n${details}`);
  }
}
