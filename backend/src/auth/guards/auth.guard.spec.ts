import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { Sessions } from '../services/sessions/sessions';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { Public } from '../decorators/public.decorator';
import { MongoRolePermissions } from '../../role/persistence/mongo/mongo-role-permissions';
import { RolePermissions } from '../../role/stores/role-permissions';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { NativeAccessService } from '../../session/native/access/native-access.service';
import {
  createExecutionContextMock,
  createModelMock,
} from '../../common/testing/test-doubles.harness-spec';

class GuardedRoutes {
  @Public()
  openRoute(this: void): void {}

  closedRoute(this: void): void {}
}

describe('AuthGuard (X-13, D-29, S-01, S-21)', () => {
  let guard: AuthGuard;
  let sessionService: {
    validateSession: jest.Mock;
  };
  let sessionCookieService: {
    read: jest.Mock;
    clear: jest.Mock;
  };
  let nativeAccess: {
    validate: jest.Mock;
  };
  let roleModel: {
    findOne: jest.Mock;
  };

  const createMockContext = (
    cookies: Record<string, string> = {},
    handler: () => void = GuardedRoutes.prototype.closedRoute,
  ): {
    context: ExecutionContext;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  } => {
    const request = {
      cookies,
      headers: {},
      user: undefined,
      session: undefined,
    };
    const response: Record<string, unknown> = {};
    const context = createExecutionContextMock({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getHandler: () => handler,
      getClass: () => GuardedRoutes,
    });

    return { context, request, response };
  };

  beforeEach(async () => {
    sessionService = {
      validateSession: jest.fn(),
    };

    sessionCookieService = {
      read: jest.fn(
        (req: { cookies?: Record<string, string> }) => req.cookies?.sid,
      ),
      clear: jest.fn(),
    };

    nativeAccess = {
      validate: jest.fn(),
    };

    roleModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue({ slug: 'user', permissions: ['read'] }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        { provide: Sessions, useValue: sessionService },
        { provide: SessionCookieService, useValue: sessionCookieService },
        { provide: NativeAccessService, useValue: nativeAccess },
        {
          provide: RolePermissions,
          useValue: new MongoRolePermissions(
            createModelMock<
              ConstructorParameters<typeof MongoRolePermissions>[0]
            >(roleModel),
          ),
        },
        Reflector,
      ],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
  });

  it('should let a @Public route through without reading the cookie', async () => {
    const { context } = createMockContext(
      {},
      GuardedRoutes.prototype.openRoute,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(sessionCookieService.read).not.toHaveBeenCalled();
    expect(sessionService.validateSession).not.toHaveBeenCalled();
  });

  it('should read cookie via sessionCookieService and throw SESSION_REQUIRED when missing', async () => {
    const { context, request } = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.SESSION_REQUIRED,
      status: 401,
    });

    expect(sessionCookieService.read).toHaveBeenCalledWith(request);
  });

  it('should clear the stale cookie when validateSession returns null', async () => {
    const { context, request, response } = createMockContext({
      sid: 'invalid-token',
    });
    sessionService.validateSession.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.SESSION_INVALID,
      status: 401,
    });

    expect(sessionCookieService.read).toHaveBeenCalledWith(request);
    expect(sessionService.validateSession).toHaveBeenCalledWith(
      'invalid-token',
    );
    expect(sessionCookieService.clear).toHaveBeenCalledWith(response);
  });

  it('should throw SESSION_INVALID when populated user is missing', async () => {
    const { context } = createMockContext({ sid: 'valid-token' });
    sessionService.validateSession.mockResolvedValue({
      user: null,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.SESSION_INVALID,
      status: 401,
    });
  });

  // Deliberate: a session read that did not populate its user carries only
  // the id. The guard must refuse it rather than read fields off the id.
  it('deliberately refuses an unpopulated session user with SESSION_INVALID', async () => {
    const { context } = createMockContext({ sid: 'valid-token' });
    sessionService.validateSession.mockResolvedValue({
      user: '507f1f77bcf86cd799439013',
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.SESSION_INVALID,
      status: 401,
    });
  });

  it('should throw SESSION_INVALID when user isDeleted', async () => {
    const { context } = createMockContext({ sid: 'valid-token' });
    sessionService.validateSession.mockResolvedValue({
      user: {
        id: '507f1f77bcf86cd799439014',
        email: 'deleted@example.com',
        isDeleted: true,
      },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.SESSION_INVALID,
      status: 401,
    });
  });

  it('should allow access when user is active', async () => {
    const { context } = createMockContext({ sid: 'valid-token' });
    const userDoc = {
      id: '507f1f77bcf86cd799439011',
      email: 'active@example.com',
      name: 'Active User',
      role: 'user',
      permissions: ['custom:perm'],
      isVerified: true,
      isDeleted: false,
    };
    const sessionDoc = { user: userDoc };

    sessionService.validateSession.mockResolvedValue(sessionDoc);

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
  });

  it('accepts a native access token when no session cookie is present', async () => {
    const { context, request } = createMockContext({});
    request.headers = { authorization: 'Bearer access-token' };
    nativeAccess.validate.mockResolvedValue({
      user: {
        id: '507f1f77bcf86cd799439011',
        email: 'active@example.com',
        name: 'Active User',
        role: 'user',
        permissions: [],
        isVerified: true,
        isDeleted: false,
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionService.validateSession).not.toHaveBeenCalled();
    expect(nativeAccess.validate).toHaveBeenCalledWith('access-token');
  });

  it('rejects a bearer token that is not a live access credential', async () => {
    const { context, request } = createMockContext({});
    request.headers = { authorization: 'Bearer refresh-token' };
    nativeAccess.validate.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.SESSION_INVALID,
      status: 401,
    });
    expect(request.user).toBeUndefined();
  });

  it('authenticates the bearer user when a cookie for another user is also sent', async () => {
    const { context, request } = createMockContext({ sid: 'cookie-token' });
    request.headers = { authorization: 'Bearer access-token' };
    const bearerUserId = '507f1f77bcf86cd799439012';
    nativeAccess.validate.mockResolvedValue({
      user: {
        id: bearerUserId,
        email: 'bearer@example.com',
        name: 'Bearer User',
        role: 'user',
        permissions: [],
        isVerified: true,
        isDeleted: false,
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(nativeAccess.validate).toHaveBeenCalledWith('access-token');
    expect(sessionService.validateSession).not.toHaveBeenCalled();
    expect(request.user).toMatchObject({
      id: '507f1f77bcf86cd799439012',
      email: 'bearer@example.com',
    });
  });

  it('fails on an invalid bearer without falling back to the cookie', async () => {
    const { context, request } = createMockContext({ sid: 'cookie-token' });
    request.headers = { authorization: 'Bearer invalid-token' };
    nativeAccess.validate.mockResolvedValue(null);
    sessionService.validateSession.mockResolvedValue({
      user: {
        id: '507f1f77bcf86cd799439011',
        email: 'cookie@example.com',
        name: 'Cookie User',
        role: 'user',
        permissions: [],
        isVerified: true,
        isDeleted: false,
      },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.SESSION_INVALID,
      status: 401,
    });
    expect(sessionService.validateSession).not.toHaveBeenCalled();
    expect(sessionCookieService.clear).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });
});
