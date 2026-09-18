export type Role = 'superadmin' | 'admin' | 'editor' | 'viewer';

// Assignable via normal team management (invites, the Members table's role picker) - superadmin
// is deliberately excluded. It's only ever granted by an existing superadmin (see the "Make Super
// Admin" action in TeamSettings) or through the superadmin-recovery process when none can log in.
export const ROLES: Role[] = ['admin', 'editor', 'viewer'];
export const ALL_ROLES: Role[] = ['superadmin', ...ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  superadmin: 'Everything an Admin can do, plus Server Settings (email and Google sign-in) and granting or revoking Super Admin.',
  admin: 'Full access - edits the landscape and manages the team.',
  editor: 'Can create, edit, and delete systems, objects, and integrations.',
  viewer: 'Read-only - can browse the canvas and inventory, but not change anything.',
};

export const canEdit = (role: Role | undefined): boolean => role === 'admin' || role === 'editor' || role === 'superadmin';
export const isAdmin = (role: Role | undefined): boolean => role === 'admin' || role === 'superadmin';
export const isSuperAdmin = (role: Role | undefined): boolean => role === 'superadmin';
