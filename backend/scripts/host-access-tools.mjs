import { createRequire } from 'node:module';

export function loadBackendTools(paths) {
  const require = createRequire(paths.manifest);
  try {
    const ts = require('typescript');
    const { register } = require('ts-node');
    const prettier = require('prettier');
    register({ project: paths.project });
    return {
      ts,
      format: async (source, output) =>
        prettier.format(source, {
          ...(await prettier.resolveConfig(output)),
          filepath: output,
          endOfLine: 'lf',
        }),
    };
  } catch (error) {
    throw new Error(
      'Backend development dependencies are unavailable; install the API workspace first',
      { cause: error },
    );
  }
}
