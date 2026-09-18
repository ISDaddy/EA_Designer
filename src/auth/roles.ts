export type Role = 'superadmin' | 'admin' | 'editor' | 'system_owner' | 'viewer';

// Assignable via normal team management (invites, the Members table's role picker) - superadmin
// is deliberately excluded. It's only ever granted by an existing superadmin (see the "Make Super
// Admin" action in TeamSettings) or through the superadmin-recovery process when none can log in.
export const ROLES: Role[] = ['admin', 'editor', 'system_owner', 'viewer'];
export const ALL_ROLES: Role[] = ['superadmin', ...ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  editor: 'Editor',
  system_owner: 'System Owner',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  superadmin: 'Everything an Admin can do, plus Server Settings (email and Google sign-in) and granting or revoking Super Admin.',
  admin: 'Full access - edits the landscape and manages the team.',
  editor: 'Can create, edit, and delete systems, objects, and integrations.',
  system_owner: 'Like a Viewer everywhere else, but full write access to the systems they own - creating objects, and connections to or from an owned system. A connection that also touches a system they don’t own needs that system’s owner or an Admin to approve it first.',
  viewer: 'Read-only - can browse the canvas and inventory, but not change anything.',
};

// True for system_owner too - they genuinely can write, just scoped to what they own. Which
// specific systems/objects/edges that covers is resolved per item in App.tsx (see
// canWriteSystem/canWriteObject/canProposeEdgeChange), not by this blanket role check.
export const canEdit = (role: Role | undefined): boolean => role === 'admin' || role === 'editor' || role === 'system_owner' || role === 'superadmin';
export const isAdmin = (role: Role | undefined): boolean => role === 'admin' || role === 'superadmin';
export const isSuperAdmin = (role: Role | undefined): boolean => role === 'superadmin';
export const isSystemOwner = (role: Role | undefined): boolean => role === 'system_owner';
