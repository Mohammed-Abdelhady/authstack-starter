# Database Management Guide

This guide covers database seeding and migration operations for the AuthStack Starter project.

## Table of Contents

- [Overview](#overview)
- [Environment Setup](#environment-setup)
- [Database Migrations](#database-migrations)
- [Database Seeding](#database-seeding)
- [Seed User Credentials](#seed-user-credentials)
- [Troubleshooting](#troubleshooting)
- [Best Practices](database-management-troubleshooting.md#best-practices)

---

## Overview

The project includes two powerful database management tools:

1. **Migrations**: Manage database schema changes over time using `migrate-mongo`
2. **Seeding**: Populate the database with initial test data for development

Both tools are designed to be:

- **Idempotent**: Safe to run multiple times
- **Environment-aware**: Different behavior for development vs production
- **Type-safe**: Full TypeScript support
- **Well-documented**: Clear error messages and logging

---

## Environment Setup

Before running migrations or seeds, ensure your environment is configured:

### 1. Set MongoDB Connection

Create a `.env` file in the backend directory:

```bash
# backend/.env
MONGO_URI=mongodb://localhost:27017/authboiler?replicaSet=rs0
NODE_ENV=development
```

Or use the default connection string:

```
mongodb://localhost:27017/authboiler?replicaSet=rs0
```

<!-- feature:docker:start -->

When the backend runs on the host and MongoDB runs in Docker Compose, use `MONGO_URI=mongodb://USER:PASS@localhost:27017/authboiler?authSource=admin&directConnection=true`.
The replica set advertises `mongodb:27017`, which the host cannot resolve.
<!-- feature:docker:end -->

### 2. Install Dependencies

Dependencies are already installed via `package.json`:

```bash
cd backend
pnpm install --frozen-lockfile
```

### 3. Start MongoDB

<!-- feature:docker:start -->

With Docker Compose:

```bash
docker-compose up -d mongodb
```

Or start a local single-node replica set:
<!-- feature:docker:end -->

```bash
mkdir -p ./mongodb-data
mongod --replSet rs0 --dbpath ./mongodb-data
```

`mongod` runs in the foreground, so leave it running and, once, in a second
shell:

```bash
mongosh --eval "rs.initiate()"
```

Sign-in runs in a transaction, so the server has to be a replica set; a
standalone `mongod` refuses transactions.

---

## Database Migrations

Migrations allow you to manage database schema changes systematically.

### Creating a Migration

Create a new migration file:

```bash
pnpm run migration:create <migration-name>
```

**Example:**

```bash
pnpm run migration:create add-user-preferences
```

This creates a file like: `migrations/20260118123456-add-user-preferences.js`

### Migration File Structure

Each migration file exports `up` and `down` functions:

```javascript
module.exports = {
  async up(db, client) {
    // Apply migration
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    console.log('✓ Migration applied');
  },

  async down(db, client) {
    // Rollback migration
    await db.collection('users').dropIndex('email_1');
    console.log('✓ Migration rolled back');
  },
};
```

### Applying Migrations

Apply all pending migrations:

```bash
pnpm run migration:up
```

### Rolling Back Migrations

Rollback the last migration:

```bash
pnpm run migration:down
```

### Checking Migration Status

View migration status:

```bash
pnpm run migration:status
```

Output example:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Status  │ Migration ID                                                   │
├────────────────────────────────────────────────────────────────────────────────┤
│ PENDING │ 20260118000001-initial-indexes.js                             │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Migration Best Practices

1. **Always test migrations** on a development database first
2. **Keep migrations reversible** - implement both `up` and `down` functions
3. **Use background index creation** for production to avoid blocking
4. **Document complex migrations** with inline comments
5. **Never modify existing migrations** - create a new one instead

---

## Database Seeding

Seeding populates the database with initial test data for development and testing.

### Running Seeds

Seed the database with test users:

```bash
pnpm run seed
```

Output:

```
🌱 Starting database seeding...
Environment: development
[Nest] 12345  - [SeedService] Starting database seeding...
[Nest] 12345  - [SeedService] Seeding users...
[Nest] 12345  - [SeedService] Created seed user: user@seed.local (user)
[Nest] 12345  - [SeedService] Created seed user: support@seed.local (support)
[Nest] 12345  - [SeedService] Created seed user: manager@seed.local (manager)
[Nest] 12345  - [SeedService] Created seed user: admin@seed.local (admin)
[Nest] 12345  - [SeedService] Seeding users completed: 4 users created
[Nest] 12345  - [SeedService] Database seeding completed: {"users":4,"total":4}
✅ Seeding completed successfully!
Summary: {
  "users": 4,
  "total": 4
}
```

### Resetting the Database

Clear all data and reseed:

```bash
pnpm run seed:reset
```

**⚠️ Warning**: This is a destructive operation that deletes all data!

### Seed Idempotency

Seeding is idempotent - safe to run multiple times:

```bash
# Run once
pnpm run seed
# Creates 4 users

# Run again
pnpm run seed
# Skips existing users, creates 0 new users
```

### Production Safety

Seeding is **blocked in production** by default:

```bash
NODE_ENV=production pnpm run seed
# Error: Seeding is not allowed in production environment.
```

To force seeding in production (not recommended):

```bash
# Modify seed.service.ts to add --force flag support
# Or manually create users via API
```

---

## Seed User Credentials

The following seed users are created for testing:

| Role    | Email                | Password      | Purpose              |
| ------- | -------------------- | ------------- | -------------------- |
| USER    | `user@seed.local`    | `User123!`    | Regular user testing |
| SUPPORT | `support@seed.local` | `Support123!` | Support role testing |
| MANAGER | `manager@seed.local` | `Manager123!` | Manager role testing |
| ADMIN   | `admin@seed.local`   | `Admin123!`   | Admin role testing   |

### Using Seed Users

#### Via API

```bash
# Login with seed admin
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@seed.local","password":"Admin123!"}'
```

#### Via Frontend

1. Navigate to login page
2. Enter seed credentials
3. Test role-based features

### Seed User Properties

All seed users have:

- ✅ Verified email (`isVerified: true`)
- ✅ Email authentication provider (`authProvider: 'email'`)
- ✅ Secure passwords (hashed with bcrypt)
- ✅ Proper role assignment
- ✅ No OAuth IDs (googleId, facebookId, githubId)

---

## Troubleshooting

## More sections

- [Troubleshooting and best practices](database-management-troubleshooting.md)
