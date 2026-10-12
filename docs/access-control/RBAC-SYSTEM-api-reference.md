# RBAC API and frontend integration

[Guide overview](RBAC-SYSTEM.md)

### API Endpoints

**Role Management**:

```
GET    /api/roles           - List all roles
GET    /api/roles/:idOrSlug - Get role by id or slug
POST   /api/roles           - Create new role
PATCH  /api/roles/:idOrSlug - Update role
DELETE /api/roles/:idOrSlug - Delete role
```

**Permission Management**:

```
GET    /api/admin/users/:id/permissions              - Get user permissions
POST   /api/admin/users/:id/permissions              - Add one permission
DELETE /api/admin/users/:id/permissions/:permission  - Remove one permission
```

Every route with its guard is in [API routes](../../backend/docs/api-routes.md).

---

## Frontend Implementation

### Permission Hooks

Use `usePermission` hook to check permissions in components:

```typescript
import { usePermission } from '@/modules/permissions';

function MyComponent() {
  const { can, canAny, canAll } = usePermission();

  if (can('users:delete:all')) {
    // User can delete users
  }

  if (canAll(['users:read:all', 'roles:read:all'])) {
    // User has BOTH permissions
  }

  if (canAny(['sessions:read:all', 'sessions:read:own'])) {
    // User has AT LEAST ONE permission
  }
}
```

### Component-Level Guards

Hide UI elements when user lacks permission:

```tsx
import { PermissionGuard, USER_PERMISSIONS } from '@/modules/permissions';

<PermissionGuard permission={USER_PERMISSIONS.DELETE_ALL}>
  <Button variant="destructive">Delete User</Button>
</PermissionGuard>;
```

**Multiple Permissions (ALL)**:

```tsx
<PermissionGuard permissions={[USER_PERMISSIONS.LIST_ALL, ROLE_PERMISSIONS.LIST_ALL]}>
  <AdminPanel />
</PermissionGuard>
```

**Any Permissions (OR)**:

```tsx
<PermissionGuard anyPermissions={[SESSION_PERMISSIONS.READ_ALL, SESSION_PERMISSIONS.READ_OWN]}>
  <SessionsList />
</PermissionGuard>
```

**With Fallback**:

```tsx
<PermissionGuard
  permission="users:delete:all"
  fallback={<p>You don't have permission to delete users.</p>}
>
  <DeleteButton />
</PermissionGuard>
```

### Route-Level Protection

Protect entire pages with `RoutePermissionGuard`:

```tsx
import { RoutePermissionGuard, ROLE_PERMISSIONS } from '@/modules/permissions';

export default function RolesPage() {
  return (
    <RoutePermissionGuard permission={ROLE_PERMISSIONS.MANAGE_ALL}>
      <RoleManagementUI />
    </RoutePermissionGuard>
  );
}
```

Users without permission are redirected to `/403` (Forbidden page).

### Navigation Guards

The `DashboardNav` component automatically shows/hides nav items based on permissions:

```tsx
const NAV_ITEMS = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    // No permission = visible to all
  },
  {
    label: 'Users',
    href: '/admin/users',
    icon: Users,
    permission: USER_PERMISSIONS.LIST_ALL,
  },
];

// Users without permission won't see the "Users" link
```

---

## API Reference

### Role Endpoints

#### GET /api/roles

List all roles.

**Permission**: `roles:list:all`

**Response**:

```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Admin",
    "slug": "admin",
    "description": "System administrator",
    "permissions": ["*"],
    "isSystemRole": true,
    "isProtected": false,
    "createdAt": "2024-01-20T10:00:00Z",
    "updatedAt": "2024-01-20T10:00:00Z"
  }
]
```

#### POST /api/roles

Create a new role.

**Permission**: `roles:create:all`

**Request Body**:

```json
{
  "name": "Custom Role",
  "description": "My custom role",
  "permissions": ["users:read:all", "sessions:read:all"]
}
```

The name takes Latin letters, digits, spaces and hyphens, and is 2 to 50 characters long. A name in another script is refused with a validation error.

**Response**: Created role object (201)

#### PATCH /api/roles/:idOrSlug

Update role properties.

**Permission**: `roles:update:all`

**Request Body**:

```json
{
  "description": "Updated description",
  "permissions": ["users:read:all", "users:update:all"]
}
```

**Response**: Updated role object (200)

#### DELETE /api/roles/:idOrSlug

Delete a role.

**Permission**: `roles:delete:all`

**Response**: Success message (200)

**Error**: 400 if role is protected

### Permission Endpoints

#### GET /api/admin/users/:id/permissions

Get user's permissions.

**Permission**: `permissions:read:all`

**Response**:

```json
{
  "permissions": ["profile:read:own", "profile:update:own", "sessions:read:own"]
}
```

#### POST /api/admin/users/:id/permissions

Add one direct permission to a user. The wildcard `*` cannot be granted here. The caller must hold the permission itself, or hold `*`. Otherwise the answer is 403 with the code `FORBIDDEN`. The caller cannot target itself or a user at or above its own role level.

**Permission**: `permissions:grant:all`

**Request Body**:

```json
{
  "permission": "reports:read:all"
}
```

**Response**: The user id and the permissions the user now has (200)

#### DELETE /api/admin/users/:id/permissions/:permission

Remove one direct permission from a user. The permission is part of the address and the request has no body. The caller does not need to hold the permission. It cannot target itself or a user at or above its own role level.

**Permission**: `permissions:revoke:all`

**Response**: The user id and the permissions the user now has (200)

---

## Usage Examples

### Example 1: Create Custom "Moderator" Role

```typescript
// 1. Login as admin
const adminSession = await login('admin@seed.local', 'Admin123!');

// 2. Create moderator role
const moderatorRole = await fetch('/api/roles', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Moderator',
    description: 'Community moderators',
    permissions: ['users:read:all', 'users:update:all', 'sessions:read:all', 'reports:read:all'],
  }),
});

// 3. Assign moderator role to user
await updateUser(userId, { role: 'moderator' });

// 4. Grant moderator permissions to user
await fetch(`/api/admin/users/${userId}/permissions`, {
  method: 'PUT',
  body: JSON.stringify({
    permissions: ['users:read:all', 'users:update:all', 'sessions:read:all', 'reports:read:all'],
  }),
});
```
