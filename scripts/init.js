#!/usr/bin/env node
import { configureBackendPort, configureFrontendPort } from './lib/config-transforms.js'; // feature:docker
import { buildNextStepLines } from './lib/init-next-steps.js';
import {
  createSetupSecrets,
  writeBackendEnvironment,
  generateFrontendEnv,
} from './lib/init-environment.js';
import {
  collectBasicInfo,
  collectEnvironmentConfig,
  collectOAuthConfig,
  collectSmtpConfig,
} from './lib/init-prompts.js';

/**
 * Project Initialization Script
 *
 * Interactive CLI to configure the boilerplate for your project.
 * Updates app name, env files, package.json, Docker configs, and more. // feature:docker
 *
 * Usage: node scripts/init.js
 */

import path from 'node:path';
import {
  colors,
  log,
  drawBox,
  readJson,
  writeJson,
  readFile,
  writeFile,
  fileExists,
  backupFile,
  createPrompt,
  askYesNo,
  printKeyValue,
  ROOT_DIR,
} from './lib/cli-utils.js';

// ═══════════════════════════════════════════════════════════════
// File Update Functions
// ═══════════════════════════════════════════════════════════════
function updatePackageJson(config) {
  // Root package.json
  const rootPkg = readJson(path.join(ROOT_DIR, 'package.json'));
  if (rootPkg) {
    rootPkg.name = config.appSlug;
    rootPkg.description = config.description;
    writeJson(path.join(ROOT_DIR, 'package.json'), rootPkg);
    log.success('Root package.json updated');
  }

  // Backend package.json
  const backendPkg = readJson(path.join(ROOT_DIR, 'backend', 'package.json'));
  if (backendPkg) {
    backendPkg.name = `${config.appSlug}-backend`;
    backendPkg.description = `${config.appTitle} Backend API`;
    backendPkg.author = config.authorName;
    writeJson(path.join(ROOT_DIR, 'backend', 'package.json'), backendPkg);
    log.success('Backend package.json updated');
  }

  // Frontend package.json
  const frontendPkg = readJson(path.join(ROOT_DIR, 'frontend', 'package.json'));
  if (frontendPkg) {
    frontendPkg.name = `${config.appSlug}-frontend`;
    writeJson(path.join(ROOT_DIR, 'frontend', 'package.json'), frontendPkg);
    log.success('Frontend package.json updated');
  }
}

// feature:docker:start
function updateDockerFiles(config) {
  const files = [
    'docker-compose.yml',
    'docker-compose.prod.yml', // feature:production
    '.env.docker.example',
  ];

  for (const file of files) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fileExists(filePath)) continue;

    const backupPath = backupFile(filePath);
    if (backupPath) {
      log.info(`Backed up ${file} to ${path.basename(backupPath)}`);
    }

    let content = readFile(filePath);

    // Update container names and database
    content = content.replaceAll('authboiler-mongodb', `${config.appSlug}-mongodb`);
    content = content.replaceAll('authboiler-backend', `${config.appSlug}-backend`);
    content = content.replaceAll('authboiler-frontend', `${config.appSlug}-frontend`);
    // feature:production:start
    content = content.replaceAll('authboiler-nginx', `${config.appSlug}-nginx`);
    content = content.replaceAll('authboiler-certbot', `${config.appSlug}-certbot`);
    // feature:production:end
    content = content.replaceAll('MONGO_DATABASE:-authboiler', `MONGO_DATABASE:-${config.dbName}`);
    content = content.replaceAll('/authboiler', `/${config.dbName}`);
    content = content.replaceAll(
      'MONGO_INITDB_DATABASE: authboiler',
      `MONGO_INITDB_DATABASE: ${config.dbName}`,
    );

    if (file.endsWith('.yml')) {
      content = configureBackendPort(content, config.env.backendPort);
      content = configureFrontendPort(content, config.env.frontendPort);
    }

    // Update frontend NEXT_PUBLIC_API_URL in compose
    content = content.replace(
      /(NEXT_PUBLIC_API_URL:\s*\${NEXT_PUBLIC_API_URL:-http:\/\/localhost:)\d+(\})/g,
      `$1${config.env.backendPort}$2`,
    );

    // Update .env.docker.example PORT and API URL
    content = content.replace(/^PORT=\d+/m, `PORT=${config.env.backendPort}`);
    content = content.replace(
      /^NEXT_PUBLIC_API_URL=http:\/\/localhost:\d+/m,
      `NEXT_PUBLIC_API_URL=http://localhost:${config.env.backendPort}`,
    );

    content = content.replace(
      /(CLIENT_URL:\s*\${CLIENT_URL:-http:\/\/localhost:)\d+(\})/g,
      `$1${config.env.frontendPort}$2`,
    );
    content = content.replace(
      /^CLIENT_URL=http:\/\/localhost:\d+/m,
      `CLIENT_URL=http://localhost:${config.env.frontendPort}`,
    );

    writeFile(filePath, content);
    log.success(`${file} updated`);
  }
}
// feature:docker:end

function updateReadmeFiles(config) {
  // Root README
  const rootReadmePath = path.join(ROOT_DIR, 'README.md');
  if (fileExists(rootReadmePath)) {
    let content = readFile(rootReadmePath);
    content = content.replace(/^# .+$/m, `# ${config.appTitle}`);
    content = content.replace(/Production-ready authentication system.+$/m, config.description);
    content = content.replace(
      /git clone.+\.git/,
      `git clone https://github.com/your-username/${config.appSlug}.git`,
    );
    content = content.replaceAll('cd FULL-MERN-AUTH-Boilerplate', `cd ${config.appSlug}`);
    writeFile(rootReadmePath, content);
    log.success('README.md updated');
  }

  // Frontend README
  const frontendReadmePath = path.join(ROOT_DIR, 'frontend', 'README.md');
  if (fileExists(frontendReadmePath)) {
    let content = readFile(frontendReadmePath);
    content = content.replace(/^# .+$/m, `# ${config.appTitle} - Frontend`);
    writeFile(frontendReadmePath, content);
    log.success('Frontend README.md updated');
  }

  // Backend README
  const backendReadmePath = path.join(ROOT_DIR, 'backend', 'README.md');
  if (fileExists(backendReadmePath)) {
    let content = readFile(backendReadmePath);
    content = content.replace(/^# .+$/m, `# ${config.appTitle} - Backend API`);
    writeFile(backendReadmePath, content);
    log.success('Backend README.md updated');
  }
}

// ═══════════════════════════════════════════════════════════════
// Summary Display
// ═══════════════════════════════════════════════════════════════
function printSummary(config) {
  drawBox('Configuration Summary', { color: colors.cyan });

  console.log(`${colors.cyan}Project:${colors.reset}`);
  printKeyValue({
    'App Name': config.appTitle,
    Slug: config.appSlug,
    Database: config.dbName,
    Description: config.description,
  });

  console.log(`\n${colors.cyan}Environment:${colors.reset}`);
  printKeyValue({
    'Frontend Port': config.env.frontendPort,
    'Backend Port': config.env.backendPort,
    'MongoDB URI': config.env.mongoUri,
  });

  console.log(`\n${colors.cyan}SMTP:${colors.reset}`);
  printKeyValue({
    Host: config.smtp.host,
    User: config.smtp.user,
  });

  console.log(`\n${colors.cyan}OAuth:${colors.reset}`);
  printKeyValue({
    Google: config.oauth.google.clientId ? 'Configured' : 'Not configured',
    Facebook: config.oauth.facebook.clientId ? 'Configured' : 'Not configured',
    GitHub: config.oauth.github.clientId ? 'Configured' : 'Not configured',
  });

  console.log('');
}

function printNextSteps(config) {
  drawBox('Setup Complete!', { color: colors.green });

  log.success(`Project "${colors.cyan}${config.appTitle}${colors.reset}" has been configured!`);

  console.log(buildNextStepLines(config).join('\n'));
}

// ═══════════════════════════════════════════════════════════════
// Main Function
// ═══════════════════════════════════════════════════════════════
async function init() {
  drawBox('Project Setup', { color: colors.cyan });

  log.info('This script will configure the boilerplate for your project.');
  log.info('Press Ctrl+C at any time to cancel.\n');

  const rl = await createPrompt();

  try {
    // Collect configuration
    const basic = await collectBasicInfo(rl);
    const env = await collectEnvironmentConfig(rl, basic.dbName);
    const smtp = await collectSmtpConfig(rl);
    const oauth = await collectOAuthConfig(rl);

    const config = {
      ...basic,
      env,
      smtp,
      oauth,
      ...createSetupSecrets(),
    };

    // Show summary
    printSummary(config);

    // Confirm
    const proceed = await askYesNo(rl, 'Proceed with this configuration?', true);

    if (!proceed) {
      log.warn('Setup cancelled by user.');
      rl.close();
      process.exit(0);
    }

    rl.close();

    // Apply configuration
    log.title('Applying Configuration...');

    // Update package.json files
    log.info('Updating package.json files...');
    updatePackageJson(config);

    // Create backend .env
    log.info('Creating backend/.env...');
    const backendBackupPath = writeBackendEnvironment(config, ROOT_DIR);
    if (backendBackupPath) {
      log.info(`Backed up backend/.env to ${path.basename(backendBackupPath)}`);
    }
    log.success('Backend .env created');

    // Create frontend .env.local
    log.info('Creating frontend/.env.local...');
    const frontendEnvPath = path.join(ROOT_DIR, 'frontend', '.env.local');
    if (fileExists(frontendEnvPath)) {
      const backupPath = backupFile(frontendEnvPath);
      if (backupPath) {
        log.info(`Backed up frontend/.env.local to ${path.basename(backupPath)}`);
      }
    }
    writeFile(frontendEnvPath, generateFrontendEnv(config), { mode: 0o600 });
    log.success('Frontend .env.local created');

    // feature:docker:start
    // Update Docker files
    log.info('Updating Docker configuration...');
    updateDockerFiles(config);
    // feature:docker:end

    // Update README files
    log.info('Updating README files...');
    updateReadmeFiles(config);

    // Print next steps
    printNextSteps(config);
  } catch (error) {
    rl.close();
    throw error;
  }
}

// Run
try {
  await init();
} catch (error) {
  log.error(`Initialization failed: ${error.message}`);
  process.exit(1);
}
