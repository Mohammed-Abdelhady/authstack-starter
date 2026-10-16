import { createRequire } from 'node:module';

const HTTP_DECORATORS = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE' };
export const ACCESS = { PUBLIC: 'Public', SIGNED_IN: 'Signed in' };
/** The setting that closes a route marked with each `AuthFeature` member. */
const FEATURE_SWITCHES = {
  PASSWORD: 'AUTH_PASSWORD_ENABLED',
  MAGIC_LINK: 'MAGIC_LINK_ENABLED',
  TWO_FACTOR: 'TWO_FACTOR_ENABLED',
  PASSKEYS: 'PASSKEYS_ENABLED',
};

const typescript = createRequire(new URL('../../../backend/package.json', import.meta.url))(
  'typescript',
);
const parse = (file, source) =>
  typescript.createSourceFile(file, source, typescript.ScriptTarget.Latest, true);

/** Every decorator on a node as `{ name, args }`, with the arguments left as syntax nodes. */
function decoratorsOf(node) {
  return (typescript.getDecorators(node) ?? []).flatMap(({ expression }) =>
    typescript.isCallExpression(expression)
      ? [{ name: expression.expression.getText(), args: [...expression.arguments] }]
      : [],
  );
}

function literalPath(decorator, file) {
  const [argument] = decorator.args;
  if (argument === undefined) return '';
  if (typescript.isStringLiteralLike(argument)) return argument.text;
  throw new Error(`${file}: @${decorator.name} takes a path this check cannot read`);
}

function featureSwitch(decorators, file) {
  const marker = decorators.find(({ name }) => name === 'RequiresFeature');
  if (!marker) return null;
  const member = marker.args[0]?.getText().split('.').pop();
  const setting = FEATURE_SWITCHES[member];
  if (!setting) throw new Error(`${file}: no setting is known for feature ${member}`);
  return setting;
}

function accessOf(decorators, permissions, file) {
  if (decorators.some(({ name }) => name === 'Public')) return [ACCESS.PUBLIC];
  const required = decorators.find(({ name }) => name === 'RequirePermissions');
  if (!required) return [ACCESS.SIGNED_IN];
  return required.args.map((argument) => {
    const permission = permissions[argument.getText()];
    if (!permission) throw new Error(`${file}: unknown permission ${argument.getText()}`);
    return permission;
  });
}

function fullPath(controllerPath, routePath, bootstrap) {
  const segments = [controllerPath, routePath].filter((segment) => segment !== '');
  if (!bootstrap.exclude.includes(controllerPath)) segments.unshift(bootstrap.prefix);
  return `/${segments.join('/')}`;
}

/** `{ 'USER_PERMISSIONS.READ_ALL': 'users:read:all' }` from the constants file. */
export function permissionConstants(source) {
  const constants = {};
  parse('permissions.ts', source).forEachChild((statement) => {
    if (!typescript.isVariableStatement(statement)) return;
    for (const { name, initializer } of statement.declarationList.declarations) {
      const object =
        initializer && typescript.isAsExpression(initializer)
          ? initializer.expression
          : initializer;
      if (!object || !typescript.isObjectLiteralExpression(object)) continue;
      for (const property of object.properties) {
        if (
          typescript.isPropertyAssignment(property) &&
          typescript.isStringLiteralLike(property.initializer)
        ) {
          constants[`${name.getText()}.${property.name.getText()}`] = property.initializer.text;
        }
      }
    }
  });
  return constants;
}

/** Every route one controller file declares. */
export function controllerRoutes(file, source, { permissions, bootstrap }) {
  const routes = [];
  parse(file, source).forEachChild((node) => {
    if (!typescript.isClassDeclaration(node)) return;
    const onClass = decoratorsOf(node);
    const controller = onClass.find(({ name }) => name === 'Controller');
    if (!controller) return;
    const controllerPath = literalPath(controller, file);
    for (const member of node.members) {
      if (!typescript.isMethodDeclaration(member)) continue;
      const onMethod = decoratorsOf(member);
      const verb = onMethod.find(({ name }) => name in HTTP_DECORATORS);
      if (!verb) continue;
      routes.push({
        method: HTTP_DECORATORS[verb.name],
        path: fullPath(controllerPath, literalPath(verb, file), bootstrap),
        access: accessOf([...onClass, ...onMethod], permissions, file),
        closedBy: featureSwitch(onMethod, file) ?? featureSwitch(onClass, file),
      });
    }
  });
  return routes;
}
