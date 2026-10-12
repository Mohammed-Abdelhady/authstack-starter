import assert from 'node:assert/strict';
import { join } from 'node:path';

const IMAGE_TAGS = {
  backend: 'authboiler-smoke-backend:local',
  frontend: 'authboiler-smoke-frontend:local',
  nginx: 'authboiler-smoke-nginx:local',
};

export function smokeModel(original, fixtureDirectory) {
  const services = {};
  for (const name of ['mongodb', 'backend', 'frontend', 'nginx']) {
    const originalService = original.services?.[name];
    assert(originalService?.healthcheck, `missing ${name} healthcheck`);
    services[name] = {
      image: name === 'mongodb' ? originalService.image : IMAGE_TAGS[name],
      restart: 'no',
      networks: ['smoke'],
      healthcheck: originalService.healthcheck,
      ...(originalService.depends_on ? { depends_on: originalService.depends_on } : {}),
      ...(originalService.deploy ? { deploy: originalService.deploy } : {}),
    };
  }
  services.mongodb.environment = { MONGO_INITDB_DATABASE: 'smoke' };
  services.mongodb.volumes = ['smoke-data:/data/db'];
  services.backend.environment = {
    NODE_ENV: 'production',
    PORT: '5000',
    MONGO_URI: 'mongodb://mongodb:27017/smoke',
    // A production start refuses an http or loopback address. Nothing in the
    // smoke network resolves these names: the probes call the services directly.
    CLIENT_URL: 'https://smoke.example.test',
    API_URL: 'https://api.smoke.example.test',
    OAUTH_STATE_SECRET: 'synthetic-docker-smoke-state-000000000000',
    AUTH_PASSWORD_ENABLED: 'true',
    MAGIC_LINK_ENABLED: 'false',
    TWO_FACTOR_ENABLED: 'false',
    PASSKEYS_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
  };
  const frontendPort = String(original.services.frontend.environment?.PORT);
  assert.equal(frontendPort, '3000', 'frontend PORT must match its listener and probe');
  services.frontend.environment = {
    NODE_ENV: 'production',
    HOSTNAME: '0.0.0.0',
    PORT: frontendPort,
  };
  services.nginx.volumes = [
    {
      type: 'bind',
      source: join(fixtureDirectory, 'nginx-http.conf'),
      target: '/etc/nginx/nginx.conf',
      read_only: true,
    },
  ];
  return { services, volumes: { 'smoke-data': {} }, networks: { smoke: { internal: true } } };
}

export function httpFixture(config) {
  const route = config.match(/location = \/health\s*\{[^{}]*'\{"status":"healthy"\}'[^{}]*\}/)?.[0];
  assert(route, 'exact HTTP health route not found');
  return `pid /tmp/nginx.pid;\nevents {}\nhttp { server { listen 8080; listen [::]:8080;\n${route}\nlocation / { return 301 https://$host$request_uri; }\n} }\n`;
}
