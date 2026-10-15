import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import request from 'supertest';
import type { Response } from 'supertest';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface HealthResponse {
  status: string;
  timestamp: string;
  authEpoch: number;
  authSchemaVersion: number;
}

describe('AppController (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  describe('Health Endpoint', () => {
    it('/health (GET)', async () => {
      const response: Response = await request(e2e.httpServer)
        .get('/health')
        .expect(200);

      const body = response.body as HealthResponse;
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(Object.keys(body).sort()).toEqual([
        'authEpoch',
        'authSchemaVersion',
        'status',
        'timestamp',
      ]);
    });
  });

  describe('CORS Configuration', () => {
    it('should include CORS headers', async () => {
      await request(e2e.httpServer)
        .get('/health')
        .expect(200)
        .expect('Access-Control-Allow-Origin', /.*/);
    });
  });

  describe('Security Headers', () => {
    it('should include Helmet security headers', async () => {
      await request(e2e.httpServer)
        .get('/health')
        .expect(200)
        .expect('X-Content-Type-Options', 'nosniff')
        .expect('X-Frame-Options', 'SAMEORIGIN')
        .expect('X-DNS-Prefetch-Control', 'off');
    });
  });

  describe('Root Endpoint', () => {
    it('/ (GET)', async () => {
      await request(e2e.httpServer).get('/api').expect(200);
    });
  });
});
