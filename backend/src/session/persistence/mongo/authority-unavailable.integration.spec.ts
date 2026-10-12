import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoNetworkError } from 'mongodb';
import type { Server } from 'node:net';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { asAuthorityUnavailable } from '../../utils/authority/authority-unavailable';

const DRIVER_TEXT =
  'connect failed to db.internal:27017, duplicate key member@example.test';

@Controller()
class AuthorityFailureController {
  @Get('/authority-failure')
  fail(): void {
    asAuthorityUnavailable(new MongoNetworkError(DRIVER_TEXT));
  }
}

@Module({ controllers: [AuthorityFailureController] })
class AuthorityFailureModule {}

describe('authority unavailable HTTP response', () => {
  let module: TestingModule;
  let app: INestApplication;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AuthorityFailureModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('does not return database driver details in the error body', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/authority-failure')
      .expect(503);

    expect(JSON.stringify(response.body)).not.toContain(DRIVER_TEXT);
  });
});
