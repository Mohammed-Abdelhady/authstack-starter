# RBAC examples, security, and testing

[Guide overview](RBAC-SYSTEM.md)

### Example 2: Temporary Permission Elevation

```typescript
// Grant temporary admin access to user
await fetch(`/api/admin/users/${userId}/permissions`, {
  method: 'POST',
  body: JSON.stringify({
    permissions: ['*'], // Wildcard
  }),
});

// Later, revoke wildcard permission
await fetch(`/api/admin/users/${userId}/permissions`, {
  method: 'DELETE',
  body: JSON.stringify({
    permissions: ['*'],
  }),
});

// Restore original permissions
await fetch(`/api/admin/users/${userId}/permissions`, {
  method: 'PUT',
  body: JSON.stringify({
    permissions: ['profile:read:own', 'profile:update:own'],
  }),
});
```

### Example 3: Permission-Based Feature Flag

```tsx
function AdvancedSettingsPanel() {
  const { can } = usePermission();

  return (
    <div>
      <h2>Settings</h2>

      {/* Basic settings - everyone can see */}
      <BasicSettings />

      {/* Advanced settings - only for power users */}
      <PermissionGuard permission="settings:advanced:access">
        <AdvancedSettings />
      </PermissionGuard>

      {/* Dangerous zone - only for admins */}
      <PermissionGuard permission="*">
        <DangerZone />
      </PermissionGuard>
    </div>
  );
}
```

---

## Security Considerations

### 1. Direct Permission Assignment

Permissions are the **source of truth**, not roles. Always check permissions, never check roles:

```typescript
// ❌ BAD - Don't check roles
if (user.role === 'admin') {
  allowAccess();
}

// ✅ GOOD - Check permissions
if (hasPermission(user.permissions, 'users:delete:all')) {
  allowAccess();
}
```

### 2. Protected Roles

The USER role is protected to prevent system breakage. Attempting to delete it returns a 400 error.

### 3. Session-Based Authentication

Sessions are stored server-side with HTTP-only cookies, preventing XSS attacks:

- Cookies are `httpOnly` (not accessible via JavaScript)
- Cookies are `secure` in production (HTTPS only)
- Sessions can be invalidated immediately on the server

### 4. Permission Validation

All permissions are validated against the allowed format (`resource:action:scope`) to prevent injection attacks.

### 5. Wildcard Permission

The `*` permission grants complete access. Only assign to trusted super administrators.

### 6. Immutable System Roles

System roles (`isSystemRole: true`) cannot have their core properties changed to prevent accidental privilege escalation.

---

## Testing

### Manual Testing

**Test Accounts** (seeded in database):

| Role    | Email                | Password      | Permissions              |
| ------- | -------------------- | ------------- | ------------------------ |
| Admin   | `admin@seed.local`   | `Admin123!`   | `*`                      |
| Manager | `manager@seed.local` | `Manager123!` | Report & user management |
| Support | `support@seed.local` | `Support123!` | Session management       |
| User    | `user@seed.local`    | `User123!`    | Own profile only         |

**Test Scenarios**:

1. **Permission Visibility**
   - Login as different users
   - Verify sidebar navigation shows correct links
   - Access `/admin/permissions-demo` as admin
   - Try accessing protected pages as regular user → should redirect to /403

2. **Role Management**
   - Create custom role as admin
   - Edit role description and permissions
   - Attempt to delete USER role → should fail
   - Delete custom role → should succeed

3. **User Permissions**
   - View user permissions on `/admin/users/permissions`
   - Add permissions to a user
   - Remove permissions from a user
   - Verify user's access changes immediately

4. **Wildcard Permission**
   - Grant `*` permission to a user
   - Verify user can access all admin features
   - Remove wildcard → verify access revoked

### Automated Testing

E2E tests are located in `backend/test/`:

- `roles.e2e-spec.ts` - Role management tests
- `permissions.e2e-spec.ts` - Permission management tests

Run tests:

```bash
cd backend
pnpm run test:e2e
```

---

## Migration from Old System

If upgrading from a role-based inheritance system:

1. **Run Migration Script**:

   ```bash
   cd backend
   pnpm run migration:up
   ```

2. **Verify Users Have Permissions**:
   - Check database: all users should have `permissions` array
   - Default permissions based on their role

3. **Update Frontend Code**:
   - Replace `RoleGuard` with `PermissionGuard`
   - Replace role checks with permission checks
   - Update navigation to use `DashboardNav`

4. **Update Backend Code**:
   - Replace `@Roles()` decorator with `@RequirePermissions()`
   - Update guards to use `PermissionGuard`

See [MIGRATION-GUIDE.md](../operations/MIGRATION-GUIDE.md) for detailed migration steps. <!-- feature:mongodb -->

---

## FAQ

**Q: Why are permissions stored on users, not roles?**
A: Maximum flexibility. Users can have custom permissions regardless of their role.

**Q: What's the purpose of roles if permissions are on users?**
A: Organizational labeling and default permission templates.

**Q: Can I change the USER role's permissions?**
A: Yes, you can update permissions, but you cannot delete or rename the role.

**Q: What happens if I give a user both `users:read:all` and `*`?**
A: Wildcard (`*`) grants all permissions, so the specific permission is redundant.

**Q: How do I revoke all permissions from a user?**
A: Use PUT `/api/admin/users/:id/permissions` with `permissions: []`.

**Q: Can regular users manage their own permissions?**
A: No, only users with `permissions:manage:all` can modify permissions.

---

## Summary

This RBAC system provides:

- ✅ Fine-grained permission control
- ✅ Flexible role management
- ✅ Secure session-based authentication
- ✅ Permission-based UI rendering
- ✅ Protected system roles
- ✅ Wildcard super admin access
- ✅ Direct user permission assignment

For implementation questions, see the codebase or contact the development team.
