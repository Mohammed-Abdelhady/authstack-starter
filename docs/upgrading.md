# Upgrade notes

## Task 0.6b, reserved permission grants

The role and account permission routes now refuse new grants of these ten reserved
permission strings:

- `users:list:staff`
- `users:read:staff`
- `users:update:staff`
- `users:delete:staff`
- `users:create:staff`
- `users:suspend:all`
- `users:suspend:staff`
- `activity:read:all`
- `sessions:read:staff`
- `sessions:delete:staff`

A role that already holds one of these permissions keeps it and can retain it
when updated. New role grants and direct account grants are refused.

If your host application uses one of these strings for its own meaning, rename it
before upgrading. Update its stored grants and permission checks to use the new
name.
