# Project Context

## Purpose

AuthStack Starter provides authentication for web and native applications, including:

-   User registration and login with email verification
-   Social authentication (Facebook, Google OAuth)
-   Password reset and forgot password functionality
-   Protected routes for authenticated users
-   Admin dashboard and role-based access control

The project is currently being refactored from an older Express/React stack to a modern NestJS/Next.js architecture while maintaining all existing authentication features.

## Tech Stack

### Backend (NestJS)

-   **Framework**: NestJS 11 (Node.js framework)
-   **Language**: TypeScript 5.x
-   **Platform**: Express.js
-   **Database**: MongoDB 7 with Mongoose 8 ODM
-   **Authentication**:
    -   Stateful cookie sessions (`sid` in development, `__Host-sid` in production)
    -   Cryptographic token hashing: SHA-256 `tokenHash` stored in database
    -   Password hashing: bcrypt
    -   Two-factor authentication: TOTP with encrypted secrets and recovery codes
    -   Passkeys: WebAuthn with `@simplewebauthn/server`
    -   OAuth: Provider registry supporting 12 identity providers plus generic OIDC
-   **Email Service**: Nodemailer with SMTP transport
-   **Validation**: class-validator and class-transformer for DTOs
-   **Security**:
    -   Helmet for HTTP security headers
    -   Rate limiting with `@nestjs/throttler`
    -   CORS configuration
-   **Testing**: Jest for unit tests, Supertest for E2E
-   **Code Quality**: ESLint, Prettier
-   **Build Tool**: NestJS CLI

### Frontend (Next.js)

-   **Framework**: Next.js 16 with App Router
-   **Language**: TypeScript 5.x
-   **UI Library**: React 19
-   **Styling**: Tailwind CSS 4
-   **Components**: shadcn/ui, Radix UI, Lucide Icons
-   **State Management & Data Fetching**: Redux Toolkit with RTK Query
-   **Form Validation**: React Hook Form with Zod
-   **Internationalization**: next-intl
-   **Testing**: Playwright for E2E testing

### Database

-   **Primary Database**: MongoDB 7
-   **ODM**: Mongoose 8
-   **Collections**: `users`, `sessions`, `roles`, `pendingregistrations`, `pendingpasswordresets`, `pendingmagiclinks`, `passkeys`, `twofactorchallenges`
-   **TTL Indexes**: Automatic expiration for sessions, verification codes, and temporary challenges

## Project Conventions

### Code Style

#### Backend (NestJS)

-   **Linting**: ESLint with TypeScript support and Prettier integration
-   **Formatting**: Prettier with single quotes and trailing commas
-   **TypeScript**: Strict type checking enabled (no `any` types)
-   **File Structure**: Modular NestJS structure with modules, controllers, services, DTOs
-   **Naming Conventions**:
    -   Classes: PascalCase (e.g., `AppController`, `AuthService`, `UserEntity`)
    -   Methods/Functions: camelCase (e.g., `createUser`, `validateToken`, `findByEmail`)
    -   Constants: UPPER_SNAKE_CASE (e.g., `API_KEY`, `MAX_LOGIN_ATTEMPTS`, `SESSION_COOKIE_MAX_AGE`)
    -   Files: kebab-case for modules (e.g., `auth.module.ts`, `user.service.ts`)
    -   DTOs: Suffix with `Dto` (e.g., `CreateUserDto`, `LoginDto`, `UpdateProfileDto`)
    -   Interfaces: Prefix with `I` or suffix with `Interface` (e.g., `IUser`, `JwtPayload`)
    -   Enums: PascalCase (e.g., `UserRole`, `AuthProvider`)
-   **Import Order**:
    1. External dependencies
    2. NestJS imports
    3. Internal modules
    4. DTOs and interfaces
    5. Utilities and constants

#### Frontend (Next.js)

-   **Linting**: ESLint with Next.js recommended configuration
-   **Styling**: Tailwind CSS utility-first approach
-   **TypeScript**: Strict type checking enabled (no `any` types)
-   **File Structure**: App Router structure with route-based organization
-   **Naming Conventions**:
    -   Components: PascalCase (e.g., `LoginForm`, `Dashboard`, `UserCard`)
    -   Hooks: camelCase with 'use' prefix (e.g., `useAuth`, `useForm`, `useLocalStorage`)
    -   Utilities: camelCase (e.g., `formatDate`, `validateEmail`, `parseJwt`)
    -   Types: PascalCase (e.g., `User`, `AuthState`, `FormErrors`)
    -   Constants: UPPER_SNAKE_CASE (e.g., `API_BASE_URL`, `TOKEN_KEY`)
-   **Component Structure**:
    -   Server Components by default (no `"use client"` unless needed)
    -   Client components only when using hooks, event handlers, or browser APIs
    -   Co-locate related components in feature folders
-   **Import Order**:
    1. React and Next.js imports
    2. External dependencies
    3. Internal components
    4. Hooks and utilities
    5. Types and constants

### Architecture Patterns

#### Backend Architecture

-   **Pattern**: Modular monolith with NestJS modules
-   **Layered Architecture**:
    -   **Controllers**: Handle HTTP requests/responses, route definitions, minimal logic
    -   **Services**: Business logic, data processing, orchestration
    -   **Repositories/Models**: Data access layer (Mongoose models)
    -   **DTOs**: Request/response validation with class-validator
    -   **Guards**: Authentication and authorization logic
    -   **Interceptors**: Response transformation, logging
    -   **Pipes**: Data validation and transformation
    -   **Filters**: Exception handling
-   **Dependency Injection**: NestJS built-in DI system (constructor injection)
-   **Module Structure** (planned):
    ```
    src/
    ├── auth/
    │   ├── auth.module.ts
    │   ├── auth.controller.ts
    │   ├── auth.service.ts
    │   ├── guards/
    │   │   ├── auth.guard.ts
    │   │   └── roles.guard.ts
    │   ├── oauth/
    │   │   ├── oauth.controller.ts
    │   │   └── strategies/
    │   └── dto/
    │       ├── register.dto.ts
    │       ├── login.dto.ts
    │       └── reset-password.dto.ts
    ├── user/
    │   ├── user.module.ts
    │   ├── user.controller.ts
    │   ├── user.service.ts
    │   ├── schemas/
    │   │   └── user.schema.ts
    │   └── dto/
    ├── mail/
    │   ├── mail.module.ts
    │   ├── mail.service.ts
    │   └── templates/
    ├── common/
    │   ├── decorators/
    │   ├── filters/
    │   ├── interceptors/
    │   └── pipes/
    └── config/
        └── configuration.ts
    ```
-   **Authentication**: Cookie sessions (httpOnly `sid`) plus an OAuth provider registry
-   **Database**: MongoDB with Mongoose ODM, typed schemas
-   **Error Handling**: Global exception filters with structured error responses
-   **Configuration**: @nestjs/config with environment validation

#### Frontend Architecture

-   **Pattern**: Component-based with Next.js App Router
-   **Directory Structure** (planned):
    ```
    src/
    ├── app/
    │   ├── (auth)/          # Auth routes group
    │   │   ├── login/
    │   │   ├── register/
    │   │   └── reset-password/
    │   ├── (protected)/     # Protected routes group
    │   │   ├── dashboard/
    │   │   └── profile/
    │   ├── layout.tsx
    │   └── page.tsx
    ├── components/
    │   ├── auth/
    │   ├── ui/              # Reusable UI components
    │   └── layout/
    ├── lib/
    │   ├── api/             # API client and endpoints
    │   ├── utils/           # Utility functions
    │   └── validation/      # Zod schemas
    ├── hooks/
    │   ├── useAuth.ts
    │   └── useLocalStorage.ts
    ├── store/
    │   └── authSlice.ts
    ├── modules/
    │   └── auth/
    ├── types/
    │   ├── user.ts
    │   └── auth.ts
    └── constants/
        └── api.ts
    ```
-   **State Management**:
    -   React Context API for global auth state
    -   Local component state with useState/useReducer
    -   Server state via Next.js data fetching
-   **Routing**: File-based routing with App Router
    -   Route groups for logical organization
    -   Middleware for protected route handling
    -   Loading and error boundaries
-   **API Communication**:
    -   Native fetch API with custom wrapper
    -   RTK Query for server state (`authApi`, feature APIs)
    -   Session cookie sent automatically; no Bearer token injection
    -   Error handling and retry logic
-   **Authentication Flow**:
    -   Session cookies (`sid`) are httpOnly; Redux only stores an `isAuthenticated` hint
    -   `getCurrentUser` validates the cookie; AuthGuard waits until validation settles
    -   Route protection via AuthGuard after RTK Query validation

### Testing Strategy

#### Backend Testing

-   **Unit Tests**: Jest with ts-jest for TypeScript
-   **E2E Tests**: Jest with Supertest for API testing
-   **Coverage**: Jest coverage reports required
-   **Test Location**: `*.spec.ts` files alongside source code
-   **Test Environment**: Node.js environment

#### Frontend Testing

-   **Testing Framework**: Jest and React Testing Library (to be configured)
-   **Component Tests**: Test component rendering and user interactions
-   **Integration Tests**: Test user flows and API integration
-   **Coverage**: Aim for >80% coverage on critical paths

### Git Workflow

#### Branching Strategy

-   **Main Branch**: `master` (production-ready code) ⚠️ Note: This project uses `master` not `main`
-   **Feature Branches**: `feature/feature-name` (new features)
-   **Bugfix Branches**: `bugfix/bug-name` (bug fixes)
-   **Refactor Branches**: `refactor/refactor-name` (code refactoring)
-   **Current Branch**: `refactor/modern-stack-nestjs-nextjs`

#### Commit Conventions

-   **Format**: Conventional Commits (https://www.conventionalcommits.org/)
    -   `feat: add two-factor authentication`
    -   `fix: resolve token expiration bug in auth service`
    -   `refactor: extract email service from auth module`
    -   `docs: update API documentation for auth endpoints`
    -   `style: format code with prettier`
    -   `test: add e2e tests for login flow`
    -   `chore: upgrade nestjs to v11.1`
    -   `perf: optimize database queries for user lookup`
-   **Commit Messages**:
    -   Use imperative mood ("add" not "added")
    -   First line max 72 characters
    -   Body provides context if needed
-   **Commit Frequency**: Small, atomic commits with clear intent

#### Pull Request Process

-   PRs target `master` branch (not `main`)
-   PRs must pass all CI/CD checks (when configured)
-   Code review required before merging
-   PR description should include:
    -   **Purpose**: What changes and why
    -   **Testing**: Manual and automated testing performed
    -   **Breaking Changes**: Any backward-incompatible changes
    -   **Migration Steps**: If database or config changes required

## Domain Context

### Authentication Flow

1. **Registration**: User provides email/password → Server sends verification email → User verifies email
2. **Login**: User provides credentials → Server validates → Sets httpOnly session cookie
3. **Social Auth**: User clicks a provider → Backend OAuth start/callback → Session cookie
4. **Password Reset**: User requests reset → Server sends a 6-digit code → User creates new password
5. **Protected Routes**: Browser sends the session cookie → Server validates → Grants/denies access

### User Roles

-   **User**: Standard authenticated user (default)
-   **Admin**: Elevated permissions for user management, system operations


## More sections

- [API, constraints, and development workflow](project-api-and-development.md)
- [Logging, testing, and troubleshooting](project-logging-testing-and-troubleshooting.md)
- [Environment variables and operational considerations](project-environment-variables.md)
