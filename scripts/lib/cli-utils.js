/**
 * CLI Utilities
 * Shared utilities for CLI scripts
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { colors, log } from './cli-output.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export * from './cli-output.js';

export const ROOT_DIR = path.resolve(__dirname, '..', '..');

// ═══════════════════════════════════════════════════════════════
// String Utilities
// ═══════════════════════════════════════════════════════════════
export function toKebabCase(str) {
  return str
    .replaceAll(/([a-z])([A-Z])/g, '$1-$2')
    .replaceAll(/[\s_]+/g, '-')
    .toLowerCase();
}

export function toSnakeCase(str) {
  return str
    .replaceAll(/([a-z])([A-Z])/g, '$1_$2')
    .replaceAll(/[\s-]+/g, '_')
    .toLowerCase();
}

export function toPascalCase(str) {
  return str
    .replaceAll(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (c) => c.toUpperCase());
}

export function toTitleCase(str) {
  return str.replaceAll(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}

// ═══════════════════════════════════════════════════════════════
// File Utilities
// ═══════════════════════════════════════════════════════════════
export function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function writeFile(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, options);
  if (typeof options === 'object' && options !== null && options.mode !== undefined) {
    fs.chmodSync(filePath, options.mode);
  }
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function copyFile(src, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

export function backupFile(filePath) {
  if (fs.existsSync(filePath)) {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const backupPath = `${filePath}.backup.${timestamp}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Validation Utilities
// ═══════════════════════════════════════════════════════════════
export function validateDomain(domain) {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain);
}

export function resolveOptionalDomain(value, fallback) {
  return value && validateDomain(value) ? value : fallback;
}

export function validateEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

export function validatePort(port) {
  const portNum = Number.parseInt(port, 10);
  return !Number.isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * True for a user name or password that can be pasted into a database address
 * as typed. `$` is refused too: the value is written unquoted into an env file,
 * where `$NAME` and `${NAME}` are read as another setting. So is a value inside
 * quotes: the env file line loses them and the address line keeps them.
 */
export function fitsInAddress(value) {
  return !/[@/#%:?$\s]/.test(value) && !/^['"](?:.*['"])?$/s.test(value);
}

export function validateMongoUri(uri) {
  return uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://');
}

// ═══════════════════════════════════════════════════════════════
// Command Execution
// ═══════════════════════════════════════════════════════════════
export function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function validateAppName(name) {
  return /^[A-Za-z0-9 ._-]{1,64}$/.test(name);
}

export function execFile(executable, args, options = {}) {
  const { silent = false, cwd = ROOT_DIR } = options;
  try {
    const result = execFileSync(executable, args, {
      cwd,
      encoding: 'utf8',
      shell: false,
      stdio: silent ? 'pipe' : 'inherit',
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function exec(command, options = {}) {
  const { silent = false, cwd = ROOT_DIR } = options;
  try {
    const result = execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit',
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function execAsync(command, options = {}) {
  const { cwd = ROOT_DIR } = options;
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Prompt Utilities
// ═══════════════════════════════════════════════════════════════
export async function createPrompt() {
  return readline.createInterface({ input, output });
}

export async function ask(rl, question, defaultValue = '') {
  const defaultHint = defaultValue ? ` ${colors.dim}(${defaultValue})${colors.reset}` : '';
  const answer = await rl.question(`${colors.cyan}?${colors.reset} ${question}${defaultHint}: `);
  return answer.trim() || defaultValue;
}

export async function askRequired(rl, question, validator = null, errorMsg = 'This field is required') {
  while (true) {
    const answer = await rl.question(`${colors.cyan}?${colors.reset} ${question}: `);
    const trimmed = answer.trim();

    if (!trimmed) {
      log.error(errorMsg);
      continue;
    }

    if (validator && !validator(trimmed)) {
      continue;
    }

    return trimmed;
  }
}

export async function askYesNo(rl, question, defaultValue = false) {
  const defaultHint = defaultValue ? 'Y/n' : 'y/N';
  const answer = await rl.question(`${colors.cyan}?${colors.reset} ${question} ${colors.dim}(${defaultHint})${colors.reset}: `);
  const trimmed = answer.trim().toLowerCase();

  if (!trimmed) return defaultValue;
  return trimmed === 'y' || trimmed === 'yes';
}

export async function askChoice(rl, question, choices) {
  console.log(`\n${colors.cyan}?${colors.reset} ${question}`);

  choices.forEach((choice, index) => {
    console.log(`  ${colors.cyan}${index + 1})${colors.reset} ${choice.label}${choice.hint ? ` ${colors.dim}(${choice.hint})${colors.reset}` : ''}`);
  });

  while (true) {
    const answer = await rl.question(`${colors.cyan}?${colors.reset} Enter choice ${colors.dim}(1-${choices.length})${colors.reset}: `);
    const choiceNum = Number.parseInt(answer.trim(), 10);

    if (choiceNum >= 1 && choiceNum <= choices.length) {
      return choices[choiceNum - 1].value;
    }

    log.error(`Invalid choice. Please enter a number between 1 and ${choices.length}.`);
  }
}
