import { validateManifest } from '../../src/manifest/validate.js';
import type { Manifest } from '../../src/types.js';

/**
 * A version 2 manifest with every dimension available, so the resolver rules
 * can be exercised without the real manifest's planned entries.
 */
export const PLAN_MANIFEST: Manifest = validateManifest({
  version: 2,
  targets: {
    web: {
      label: 'Web app (Next.js)',
      default: true,
      files: [],
      workspaces: ['frontend'],
      envFiles: [],
    },
    'native-expo': {
      label: 'Mobile app, Expo',
      default: false,
      files: [],
      workspaces: ['mobile/expo'],
      envFiles: [],
      requires: { shared: ['native-core'], targets: [] },
      needsSignInSite: true,
    },
    'native-cli': {
      label: 'Mobile app, React Native CLI',
      default: false,
      files: [],
      workspaces: ['mobile/cli'],
      envFiles: [],
      requires: { shared: ['native-core'] },
      needsSignInSite: true,
    },
    'webos-shell': {
      label: 'WebOS shell',
      default: false,
      files: [],
      workspaces: ['webos'],
      envFiles: [],
    },
  },
  shared: {
    'native-core': { files: [], workspaces: ['mobile/core'] },
  },
  databases: {
    mongodb: {
      label: 'MongoDB',
      default: true,
      files: [],
      envVars: [],
    },
    postgres: {
      label: 'PostgreSQL',
      default: false,
      files: [],
      envVars: [],
    },
  },
  options: {
    docker: { label: 'Docker files', default: true, files: [], requires: [] },
    production: {
      label: 'Production nginx and compose',
      default: true,
      files: [],
      requires: ['docker'],
    },
    'locale-ar': {
      label: 'Arabic locale',
      default: true,
      files: [],
      requires: [],
    },
  },
  presets: {
    minimal: { targets: ['web'], features: ['email-password'], options: [] },
    standard: {
      targets: ['web'],
      features: 'defaults',
      options: ['docker', 'production', 'locale-ar'],
    },
    everything: { targets: 'available', features: 'available', options: 'available' },
  },
  features: {
    'email-password': {
      label: 'Email and password',
      description: 'Password sign-in.',
      kind: 'credential',
      default: true,
      files: [],
      envVars: [],
      requires: [],
      docs: [],
    },
    google: {
      label: 'Google',
      description: 'Sign in with Google.',
      kind: 'oauth',
      default: true,
      files: [],
      envVars: [],
      requires: ['oauth-core'],
      docs: [],
    },
    'oauth-core': {
      label: 'OAuth core',
      description: 'Shared OAuth plumbing.',
      kind: 'hidden',
      default: false,
      files: [],
      envVars: [],
      requires: [],
      docs: [],
    },
    'web-only': {
      label: 'Web only widget',
      description: 'Only renders in the browser.',
      kind: 'oauth',
      default: false,
      files: [],
      envVars: [],
      requires: [],
      docs: [],
      targets: ['web'],
    },
    'web-widget-user': {
      label: 'Web widget user',
      description: 'Needs the web only widget.',
      kind: 'oauth',
      default: false,
      files: [],
      envVars: [],
      requires: ['web-only'],
      docs: [],
    },
    'web-provider': {
      label: 'Web provider',
      description: 'Provider that only runs in the browser.',
      kind: 'oauth',
      default: false,
      files: [],
      envVars: [],
      requires: ['oauth-core'],
      docs: [],
      targets: ['web'],
    },
  },
  core: { alwaysRemoveFiles: [] },
});
