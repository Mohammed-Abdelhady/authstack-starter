module.exports = {
  'backend/**/*.{ts,js,json}': ['prettier --write'],
  'backend/**/*.ts': ['pnpm --filter backend exec eslint --fix --max-warnings 0'],
  'frontend/**/*.{ts,tsx,js,jsx,json}': ['prettier --write'],
  'frontend/**/*.{ts,tsx}': ['pnpm --filter frontend exec eslint --fix --max-warnings 0'],
  'packages/create-authstack-starter/**/*.{ts,js,json,mjs}': ['prettier --write'],
  'packages/create-authstack-starter/**/*.ts': [
    'pnpm --filter create-authstack-starter exec eslint --fix --max-warnings 0',
  ],
  'shared/**/*.{ts,tsx,js,json}': ['prettier --write'],
  'shared/core/**/*.ts': ['pnpm --filter @app/core exec eslint --fix --max-warnings 0'],
  'shared/sdk/**/*.ts': ['pnpm --filter @app/sdk exec eslint --fix --max-warnings 0'],
  'mobile/**/*.{ts,tsx,js,jsx,cjs,mts,json}': ['prettier --write'],
  'mobile/adapters/**/*.ts': [
    'pnpm --filter @app/native-adapters exec eslint --fix --max-warnings 0',
  ],
  'mobile/auth/**/*.ts': ['pnpm --filter @app/native-auth exec eslint --fix --max-warnings 0'],
  'mobile/cli/**/*.{ts,tsx}': ['pnpm --filter @app/mobile-cli exec eslint --fix --max-warnings 0'],
  'mobile/device-key/**/*.ts': ['pnpm --filter @app/device-key exec eslint --fix --max-warnings 0'],
  'mobile/expo/**/*.{ts,tsx}': ['pnpm --filter @app/mobile-expo exec eslint --fix --max-warnings 0'],
  'mobile/metro/**/*.{ts,cjs}': [
    'pnpm --filter @app/metro-config exec eslint --fix --max-warnings 0',
  ],
  'mobile/ui/**/*.{ts,tsx}': ['pnpm --filter @app/native-ui exec eslint --fix --max-warnings 0'],
  '*.{md,yml,yaml}': ['prettier --write'],
};
