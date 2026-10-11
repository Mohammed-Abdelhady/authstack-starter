# User, Roles & Permissions

This document describes the user model, role hierarchy, and permission system.

## Overview

The system implements a **role-based access control (RBAC)** with additional **fine-grained permissions** for flexible access management.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Access Control Hierarchy                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                         ADMIN                            │   │
│   │              Full system access (*)                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                        MANAGER                           │   │
│   │        Team management, reports, user oversight          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                        SUPPORT                           │   │
│   │           Customer service, ticket handling              │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                          USER                            │   │
│   │              Basic authenticated user                    │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. User Model

### Schema Location

`src/user/persistence/mongo/schemas/user.schema.ts`

### Fields

| Field                | Type    | Required | Description                                |
| -------------------- | ------- | -------- | ------------------------------------------ |
| email                | string  | Yes      | Unique email address (lowercase)           |
| password             | string  | No\*     | Hashed password (hidden from queries)      |
| name                 | string  | Yes      | Display name (2-50 chars)                  |
| role                 | enum    | Yes      | User role (default: USER)                  |
| isVerified           | boolean | Yes      | Email verification status (default: false) |
| googleId             | string  | No       | Google OAuth identifier                    |
| facebookId           | string  | No       | Facebook OAuth identifier                  |
| verificationToken    | string  | No       | Email verification token                   |
| verificationExpires  | Date    | No       | Verification token expiry                  |
| resetPasswordToken   | string  | No       | Password reset token                       |
| resetPasswordExpires | Date    | No       | Reset token expiry                         |
| isDeleted            | boolean | Yes      | Soft delete flag (default: false)          |
| deletedAt            | Date    | No       | Soft delete timestamp                      |
| createdAt            | Date    | Auto     | Creation timestamp                         |
| updatedAt            | Date    | Auto     | Last update timestamp                      |

\*Password is optional for OAuth-only users

### User Interface

```typescript
interface IUser {
  _id: Types.ObjectId;
  email: string;
  password?: string;
  name: string;
  role: UserRole;
  isVerified: boolean;
  googleId?: string;
  facebookId?: string;
  verificationToken?: string;
  verificationExpires?: Date;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 2. Roles

### Role Enum

Location: `src/user/enums/user-role.enum.ts`

```typescript
enum UserRole {
  USER = 'user',
  SUPPORT = 'support',
  MANAGER = 'manager',
  ADMIN = 'admin',
}
```

### Role Descriptions

#### USER (Default)

- **Level**: 1 (lowest)
- **Purpose**: Standard authenticated user
- **Access**: Own profile and personal resources
- **Assigned**: Automatically on registration

#### SUPPORT

- **Level**: 2
- **Purpose**: Customer service operations
- **Access**: View user issues, respond to tickets
- **Assigned**: By Manager or Admin

#### MANAGER

- **Level**: 3
- **Purpose**: Team and resource management
- **Access**: All SUPPORT permissions + team oversight, reports
- **Assigned**: By Admin

#### ADMIN

- **Level**: 4 (highest)
- **Purpose**: Full system administration
- **Access**: All permissions (wildcard \*)
- **Assigned**: Database seed or by another Admin

### Role Hierarchy

```typescript
const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.USER]: 1,
  [UserRole.SUPPORT]: 2,
  [UserRole.MANAGER]: 3,
  [UserRole.ADMIN]: 4,
};

// Check if user has at least a certain role level
function hasMinimumRole(user: IUser, minRole: UserRole): boolean {
  return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[minRole];
}
```

---

## 3. Permissions

### Permission Model

Location: `src/permission/schemas/permission.schema.ts`

Permissions provide **fine-grained access control** beyond roles. They allow:

- Granting specific access to lower-level users
- Revoking specific access from higher-level users
- Time-limited access (expiring permissions)

### Permission Fields

| Field      | Type     | Required | Description                                   |
| ---------- | -------- | -------- | --------------------------------------------- |
| user       | ObjectId | Yes      | Reference to User                             |
| permission | string   | Yes      | Permission string (format: `resource:action`) |
| granted    | boolean  | Yes      | Whether permission is granted                 |
| scope      | enum     | No       | Permission scope: 'own', 'all', 'team'        |
| grantedBy  | ObjectId | No       | Admin who granted the permission              |
| expiresAt  | Date     | No       | Permission expiration (optional)              |

### Permission Format

```
resource:action
```

**Resources:**

- `profile` - User profile
- `users` - User management
- `sessions` - Session management
- `permissions` - Permission management
- `reports` - Reporting system
- `settings` - System settings

**Actions:**

- `read` - View resource
- `create` - Create resource
- `update` - Modify resource
- `delete` - Remove resource
- `list` - List resources
- `*` - All actions (wildcard)

**Scopes:**

- `own` - Only user's own resources
- `team` - Team resources (future)
- `all` - All resources

### Permission Examples

```typescript
// User can only read their own profile
{ user: userId, permission: 'profile:read', granted: true, scope: 'own' }

// Support can view all user profiles
{ user: supportId, permission: 'users:read', granted: true, scope: 'all' }

// Temporary admin access (expires in 24h)
{ user: userId, permission: 'settings:update', granted: true, expiresAt: tomorrow }

// Explicitly deny a permission (override role)
{ user: managerId, permission: 'users:delete', granted: false }
```

---

## 4. Default Permissions by Role

Location: `src/permission/constants/default-permissions.ts`

### USER Permissions

```typescript
const DEFAULT_USER_PERMISSIONS = [
  'profile:read',
  'profile:update',
  'sessions:read', // View own sessions
  'sessions:delete', // Logout from devices
];
```

### SUPPORT Permissions

```typescript
const DEFAULT_SUPPORT_PERMISSIONS = [
  ...DEFAULT_USER_PERMISSIONS,
  'users:read', // View user profiles (for support)
  'tickets:read', // View support tickets
  'tickets:update', // Respond to tickets
];
```

### MANAGER Permissions

```typescript
const DEFAULT_MANAGER_PERMISSIONS = [
  ...DEFAULT_SUPPORT_PERMISSIONS,
  'users:list', // List all users
  'reports:read', // View reports
  'team:read', // View team members
  'team:update', // Manage team
];
```

### ADMIN Permissions

```typescript
const DEFAULT_ADMIN_PERMISSIONS = ['*']; // Full access
```

---

## 5. Access Control Flow

### Checking Access

```
Request with action "users:delete"
           │
           ▼
┌─────────────────────────┐
│ 1. Check explicit       │
│    permission override  │──Found & Granted──> Allow
└───────────┬─────────────┘
            │ Not Found
            ▼
┌─────────────────────────┐
│ 2. Check explicit       │
│    permission denial    │──Found & Denied──> Deny
└───────────┬─────────────┘
            │ Not Found
            ▼
┌─────────────────────────┐
│ 3. Check role default   │
│    permissions          │──Has Permission──> Allow
└───────────┬─────────────┘
            │ No Permission
            ▼
         Deny
```

### Implementation Example

```typescript
async function checkPermission(
  userId: ObjectId,
  permission: string,
  scope?: 'own' | 'all' | 'team',
): Promise<boolean> {
  // 1. Check for explicit override
  const override = await Permission.findOne({
    user: userId,
    permission,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });

  if (override) {
    return override.granted;
  }

  // 2. Get user role
  const user = await User.findById(userId);
  if (!user) return false;

  // 3. Check role default permissions
  const rolePermissions = getRolePermissions(user.role);

  // Admin has wildcard
  if (rolePermissions.includes('*')) return true;

  // Check exact permission
  if (rolePermissions.includes(permission)) return true;

  // Check resource wildcard (e.g., users:* for users:delete)
  const [resource] = permission.split(':');
  if (rolePermissions.includes(`${resource}:*`)) return true;

  return false;
}
```

---

## 6. Guard Usage

### Role-Based Guard

```typescript
// Require minimum MANAGER role
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
@Get('reports')
async getReports() { ... }
```

### Permission-Based Guard

```typescript
// Require specific permission
@UseGuards(AuthGuard, PermissionGuard)
@RequirePermission('users:delete')
@Delete('users/:id')
async deleteUser() { ... }
```

### Combined Guards

Authentication is global, so a route only lists the guard it adds on top.

```typescript
// Require: Authenticated + MANAGER role
@UseGuards(RolesGuard)
@Roles(UserRole.MANAGER)
@Get('team')
async getTeam() { ... }
```

---

## 7. Database Indexes

### User Collection

```javascript
// Unique email
db.users.createIndex({ email: 1 }, { unique: true });

// OAuth lookups
db.users.createIndex({ googleId: 1 }, { sparse: true });
db.users.createIndex({ facebookId: 1 }, { sparse: true });

// Soft delete queries
db.users.createIndex({ isDeleted: 1 });

// Recent users
db.users.createIndex({ createdAt: -1 });
```

### Permission Collection

```javascript
// User permission lookup
db.permissions.createIndex({ user: 1 });

// Unique user+permission combo
db.permissions.createIndex({ user: 1, permission: 1 }, { unique: true });

// Auto-cleanup expired permissions
db.permissions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

---

## 8. Common Operations

### Assign Role to User

```typescript
await User.findByIdAndUpdate(userId, { role: UserRole.SUPPORT });
```

### Grant Temporary Permission

```typescript
await Permission.create({
  user: userId,
  permission: 'reports:read',
  granted: true,
  grantedBy: adminId,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
});
```

### Revoke Permission

```typescript
// Option 1: Delete the permission
await Permission.deleteOne({ user: userId, permission: 'reports:read' });

// Option 2: Explicitly deny (overrides role default)
await Permission.findOneAndUpdate(
  { user: userId, permission: 'users:delete' },
  { granted: false },
  { upsert: true },
);
```

### Check User's Effective Permissions

```typescript
async function getEffectivePermissions(userId: ObjectId): Promise<string[]> {
  const user = await User.findById(userId);
  const rolePermissions = getRolePermissions(user.role);

  const overrides = await Permission.find({ user: userId });

  const granted = new Set(rolePermissions);

  for (const override of overrides) {
    if (override.expiresAt && override.expiresAt < new Date()) continue;

    if (override.granted) {
      granted.add(override.permission);
    } else {
      granted.delete(override.permission);
    }
  }

  return Array.from(granted);
}
```

---

## 9. Security Considerations

1. **Role Assignment**: Only ADMIN can assign ADMIN role
2. **Permission Expiry**: Use TTL for temporary elevated access
3. **Audit Trail**: `grantedBy` field tracks who granted permissions
4. **Soft Delete**: Users are never hard-deleted (audit trail)
5. **Password Hiding**: Password field excluded from default queries
6. **Verification Required**: Some actions require `isVerified: true`
7. **Role Permission Ceiling**: Creating a role or adding permissions to it only accepts permissions the caller holds, and adding `*` requires a caller who holds `*`. Existing permissions may be retained. The same ceiling applies to a direct permission added to a user, and to a role assigned to a user or given to a new account: the caller must hold every permission the role carries
8. **Role Hierarchy on Edits**: A role is edited only by a caller whose level is above it
9. **Last Administrator**: The last active administrator cannot deactivate their own account

---

## 10. Migration Notes

### Adding New Role

1. Add to `UserRole` enum
2. Define default permissions in `default-permissions.ts`
3. Update guards if using role hierarchy
4. Update documentation

### Adding New Permission

1. Document the new permission format
2. Add to relevant role's default permissions
3. Apply guard to protected routes
