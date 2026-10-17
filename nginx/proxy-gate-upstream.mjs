import { createServer } from 'node:http';

const manifest = JSON.parse(process.env.GATE_MANIFEST ?? 'null');
if (!manifest || !Array.isArray(manifest.associationPaths) || !Array.isArray(manifest.paths)) {
  throw new Error('Synthetic upstream requires complete fixture metadata');
}
const LINK_HOST = manifest.host;
const ASSOCIATIONS = new Set(manifest.associationPaths);
const ALLOWED = new Set([...manifest.associationPaths, ...manifest.paths]);
const counts = { backend: 0, frontend: 0 };

// Synthetic upstreams isolate nginx routing from application and database startup.
createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://fixture.invalid').pathname);
  if (path === '/gate/stats') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(counts));
    return;
  }
  if (path === '/health') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ status: 'healthy' }));
    return;
  }
  counts.backend += 1;
  const headers = request.headers;
  if (headers.host !== LINK_HOST || !ALLOWED.has(path)) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('X-Gate-Upstream', 'backend');
  response.setHeader('X-Gate-Host', headers.host);
  response.setHeader('X-Gate-Forwarded-Host', headers['x-forwarded-host'] ?? '');
  response.setHeader('X-Gate-Forwarded-Proto', headers['x-forwarded-proto'] ?? '');
  response.setHeader('X-Gate-Forwarded-Port', headers['x-forwarded-port'] ?? '');
  response.setHeader('X-Gate-Forwarded-For', headers['x-forwarded-for'] ?? '');
  response.setHeader('X-Gate-Real-IP', headers['x-real-ip'] ?? '');
  response.setHeader('X-Gate-Forwarded', headers.forwarded ?? '');
  if (ASSOCIATIONS.has(path)) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ syntheticAssociation: path }));
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', "script-src 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Robots-Tag', 'noindex');
    response.end('<!doctype html><html lang="en"><title>Proxy fixture</title></html>');
  }
}).listen(5000, '0.0.0.0');

createServer((_request, response) => {
  counts.frontend += 1;
  response.setHeader('Content-Type', 'text/plain');
  response.end('synthetic frontend reached');
}).listen(3000, '0.0.0.0');
