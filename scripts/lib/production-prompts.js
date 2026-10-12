import crypto from 'node:crypto';
import {
  log,
  toSnakeCase,
  validateDomain,
  resolveOptionalDomain,
  validateEmail,
  validatePort,
  fitsInAddress,
  ask,
  askRequired,
  askChoice,
} from './cli-utils.js';

const SSL_TYPES = [
  { label: "Let's Encrypt", value: 'letsencrypt', hint: 'Recommended for production' },
  { label: 'Self-Signed', value: 'self-signed', hint: 'Development/testing only' },
];

// ═══════════════════════════════════════════════════════════════
// Domain Configuration
// ═══════════════════════════════════════════════════════════════
export async function configureDomains(rl) {
  log.step('Domain Configuration');

  const mainDomain = await askRequired(rl, 'Main domain (e.g., example.com)', (value) => {
    if (!validateDomain(value)) {
      log.error('Invalid domain format');
      return false;
    }
    return true;
  });

  const frontendDomain = await ask(rl, 'Frontend domain', `www.${mainDomain}`);
  if (frontendDomain && !validateDomain(frontendDomain)) {
    log.warn('Invalid frontend domain, using default');
  }

  const backendDomain = await ask(rl, 'Backend API domain', `api.${mainDomain}`);
  if (backendDomain && !validateDomain(backendDomain)) {
    log.warn('Invalid backend domain, using default');
  }

  return {
    mainDomain,
    frontendDomain: resolveOptionalDomain(frontendDomain, `www.${mainDomain}`),
    backendDomain: resolveOptionalDomain(backendDomain, `api.${mainDomain}`),
  };
}

// ═══════════════════════════════════════════════════════════════
// SSL Configuration
// ═══════════════════════════════════════════════════════════════
export async function configureSSL(rl) {
  log.step('SSL Certificate Configuration');

  const email = await askRequired(rl, 'Email for SSL certificates', (value) => {
    if (!validateEmail(value)) {
      log.error('Invalid email format');
      return false;
    }
    return true;
  });

  const sslType = await askChoice(rl, 'Choose SSL certificate type:', SSL_TYPES);

  if (sslType === 'self-signed') {
    log.warn('Self-signed certificates should NOT be used in production!');
    log.warn('Browsers will show security warnings.');
  }

  return { email, sslType };
}

// ═══════════════════════════════════════════════════════════════
// Database Configuration
// ═══════════════════════════════════════════════════════════════
/** Asks until the answer can go into the database address as typed. */
async function askForAddress(rl, question, fallback) {
  while (true) {
    const answer = await ask(rl, question, fallback);
    if (fitsInAddress(answer)) return answer;
    log.error(
      'Use none of @ / # % : ? $ and no space, and no quotes around the value. It goes into the database address as typed.',
    );
  }
}

export async function configureDatabase(rl, appSlug) {
  log.step('MongoDB Configuration');

  const username = await askForAddress(rl, 'MongoDB username', 'admin');
  const passwordInput = await askForAddress(rl, 'MongoDB password (leave empty to generate)', '');
  const password = passwordInput || crypto.randomBytes(32).toString('base64url');
  const dbName = await ask(rl, 'Database name', toSnakeCase(appSlug));

  return { username, password, dbName };
}

// ═══════════════════════════════════════════════════════════════
// Port Configuration
// ═══════════════════════════════════════════════════════════════
export async function configurePorts(rl) {
  log.step('Port Configuration');

  const httpPort = await ask(rl, 'Nginx HTTP port', '80');
  const httpsPort = await ask(rl, 'Nginx HTTPS port', '443');

  if (!validatePort(httpPort)) {
    log.warn('Invalid HTTP port, using 80');
  }
  if (!validatePort(httpsPort)) {
    log.warn('Invalid HTTPS port, using 443');
  }

  return {
    httpPort: validatePort(httpPort) ? httpPort : '80',
    httpsPort: validatePort(httpsPort) ? httpsPort : '443',
  };
}
