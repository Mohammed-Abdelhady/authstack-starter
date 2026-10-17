import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const DNS_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;
const UNSAFE_PATH = /[\s\u0000-\u001f\u007f%?#\\]/u;

function normalizedPath(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.includes('//') ||
    UNSAFE_PATH.test(value) ||
    /\p{Cc}/u.test(value) ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Link-host paths must be exact normalized pathnames');
  }
  return value;
}

function stringPaths(value, name) {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} array`);
  return value.map(normalizedPath);
}

function metadata(manifest) {
  if (
    typeof manifest.apiPrefix !== 'string' ||
    !manifest.apiPrefix ||
    manifest.apiPrefix.startsWith('/') ||
    manifest.apiPrefix.endsWith('/')
  ) {
    throw new Error('Expected the raw API prefix');
  }
  const apiPath = normalizedPath(`/${manifest.apiPrefix}`);
  const reserved = stringPaths(manifest.reservedPathPrefixes, 'reservedPathPrefixes');
  if (reserved.some((prefix) => prefix === '/' || prefix.endsWith('/'))) {
    throw new Error('Reserved prefixes must name namespaces without a trailing slash');
  }
  const acme = normalizedPath(manifest.acmeChallengePrefix);
  if (
    acme === '/' ||
    !acme.endsWith('/') ||
    !reserved.includes(acme.slice(0, -1)) ||
    !reserved.includes(apiPath)
  ) {
    throw new Error('Reserved namespaces must include the API and ACME prefixes');
  }
  return {
    acme,
    reserved,
    associations: stringPaths(manifest.associationPaths, 'associationPaths'),
  };
}

function quotedPath(value) {
  // nginx keeps a dollar sign literally inside a quoted location name.
  return value.replaceAll('"', '\\"');
}

function exactPath(value, reserved) {
  const path = normalizedPath(value);
  const lower = path.toLowerCase();
  if (
    reserved.some(
      (prefix) => lower === prefix.toLowerCase() || lower.startsWith(`${prefix.toLowerCase()}/`),
    )
  ) {
    throw new Error('Link-host path overlaps a reserved namespace');
  }
  return quotedPath(path);
}

function hostname(value) {
  if (typeof value !== 'string' || value !== value.toLowerCase()) {
    throw new Error('Link-host manifest must contain a normalized hostname');
  }
  const ip = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (
    !isIP(ip) &&
    (!DNS_HOST.test(value) ||
      value
        .split('.')
        .some(
          (label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'),
        ))
  ) {
    throw new Error('Link-host manifest contains an invalid hostname');
  }
  return value;
}

function server(host, locations, acmePrefix, tls) {
  const port = tls ? 8443 : 8080;
  const certificates = tls
    ? `
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_trusted_certificate /etc/nginx/ssl/chain.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_session_tickets off;
`
    : '';
  const challenge = tls
    ? ''
    : `        location ^~ "${quotedPath(acmePrefix)}" {
            default_type text/plain;
            root /var/www/certbot;
        }

`;
  return `    server {
        listen ${port}${tls ? ' ssl' : ''};
        listen [::]:${port}${tls ? ' ssl' : ''};
        server_name ${host};
${certificates}
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Forwarded "";
        proxy_set_header Connection "";
        proxy_set_header Upgrade "";
        proxy_redirect off;

${challenge}${locations}
        location / { return 404; }
    }
`;
}

/** Input comes from the backend's validated effective configuration. */
export function renderNativeLinkHost(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Expected a link-host manifest object');
  }
  const policy = metadata(manifest);
  const pages = stringPaths(manifest.paths, 'paths');
  if (manifest.host === undefined || manifest.host === null || manifest.host === '') {
    if (pages.length) throw new Error('An absent host must have no paths');
    return '';
  }
  const host = hostname(manifest.host);
  const paths = [
    ...new Set([...policy.associations, ...pages].map((path) => exactPath(path, policy.reserved))),
  ].sort();
  const locations = paths
    .map(
      (path) => `        location = "${path}" {
            if ($request_method !~ ^(?:GET|HEAD)$) { return 405; }
            proxy_pass http://backend;
        }
`,
    )
    .join('\n');
  return (
    server(host, locations, policy.acme, false) + '\n' + server(host, locations, policy.acme, true)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(renderNativeLinkHost(JSON.parse(readFileSync(0, 'utf8'))));
}
