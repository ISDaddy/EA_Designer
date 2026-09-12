export type Role = 'admin' | 'editor' | 'viewer';

export const ROLES: Role[] = ['admin', 'editor', 'viewer'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Full access - edits the landscape and manages the team.',
  editor: 'Can create, edit, and delete systems, objects, and integrations.',
  viewer: 'Read-only - can browse the canvas and inventory, but not change anything.',
};

export const canEdit = (role: Role | undefined): boolean => role === 'admin' || role === 'editor';
export const isAdmin = (role: Role | undefined): boolean => role === 'admin';
