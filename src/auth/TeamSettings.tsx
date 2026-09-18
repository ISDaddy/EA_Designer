import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Copy, LogOut, Send, ShieldCheck, ShieldAlert, Trash2, Crown } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, labelClass } from '../ui';
import { useAuth } from './useAuth';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, isSuperAdmin } from './roles';
import type { Role } from './roles';
import { SuperAdminRecovery } from './SuperAdminRecovery';

type TeamUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  nda_accepted_version: string | null;
  nda_accepted_at: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: Role;
  token: string;
  created_at: string;
  expires_at: string;
};

function inviteLink(token: string): string {
  return `${window.location.origin}/?invite=${token}`;
}

export function TeamSettings() {
  const { user, logout } = useAuth();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [ndaVersion, setNdaVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [roleActionError, setRoleActionError] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [usersRes, invitesRes] = await Promise.all([apiFetch('/users'), apiFetch('/invites')]);
      const usersData = (await parseJsonOrError(usersRes)) as { users: TeamUser[]; ndaVersion: string };
      const invitesData = (await parseJsonOrError(invitesRes)) as { invites: Invite[] };
      setUsers(usersData.users);
      setNdaVersion(usersData.ndaVersion);
      setInvites(invitesData.invites);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the team.');
    }
  }, []);

  useEffect(() => {
    // Not routed through `loadAll` (used by the mutation handlers below to refresh afterwards) -
    // calling a function known to set state from directly inside an effect body trips the
    // "set-state-in-effect" lint rule, even for a plain fetch-on-mount.
    let cancelled = false;
    (async () => {
      try {
        const [usersRes, invitesRes] = await Promise.all([apiFetch('/users'), apiFetch('/invites')]);
        const usersData = (await parseJsonOrError(usersRes)) as { users: TeamUser[]; ndaVersion: string };
        const invitesData = (await parseJsonOrError(invitesRes)) as { invites: Invite[] };
        if (cancelled) return;
        setUsers(usersData.users);
        setNdaVersion(usersData.ndaVersion);
        setInvites(invitesData.invites);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load the team.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const copyLink = (link: string, id: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteMessage(null);
    try {
      const res = await apiFetch('/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, appUrl: window.location.origin }),
      });
      const data = (await parseJsonOrError(res)) as { link: string; emailSent: boolean; emailError?: string };
      setInviteMessage({
        ok: data.emailSent,
        text: data.emailSent
          ? `Invite emailed to ${inviteEmail}.`
          : `Couldn't send the email${data.emailError ? ` (${data.emailError})` : ''} - copy the link below and send it yourself.`,
        link: data.link,
      });
      setInviteEmail('');
      loadAll();
    } catch (err) {
      setInviteMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (id: string, role: Role) => {
    try {
      await parseJsonOrError(await apiFetch(`/users/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
      }));
      loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role.');
    }
  };

  const handleSuperAdminChange = async (id: string, role: 'superadmin' | 'admin') => {
    setRoleActionError('');
    try {
      await parseJsonOrError(await apiFetch(`/users/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
      }));
      loadAll();
    } catch (err) {
      setRoleActionError(err instanceof Error ? err.message : 'Failed to update super admin status.');
    }
  };

  const handleRemoveUser = async (id: string) => {
    if (!window.confirm('Remove this person? They will lose access immediately.')) return;
    try {
      await parseJsonOrError(await apiFetch(`/users/${id}`, { method: 'DELETE' }));
      loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove this person.');
    }
  };

  const handleRevokeInvite = async (id: string) => {
    await apiFetch(`/invites/${id}`, { method: 'DELETE' });
    loadAll();
  };

  return (
    <section
      className="p-5 flex flex-col gap-6"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>Team</h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Manage who has access to this workspace and what they're allowed to do.
          </p>
        </div>
        {user && (
          <button className={buttonSecondaryClass} onClick={logout}>
            <LogOut size={14} />Log out
          </button>
        )}
      </div>

      {loadError && (
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Invite form */}
      <div>
        <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Invite someone</span>
        <form className="flex gap-2 flex-wrap items-end" onSubmit={handleInvite}>
          <div className="flex-1 min-w-[200px]">
            <label className={labelClass}>Email</label>
            <input
              type="email"
              className={inputClass}
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Role</label>
            <select className={`${inputClass} w-auto`} value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <button type="submit" className={buttonPrimaryClass} disabled={inviting}>
            <Send size={14} />{inviting ? 'Sending...' : 'Send Invite'}
          </button>
        </form>
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{ROLE_DESCRIPTIONS[inviteRole]}</p>

        {inviteMessage && (
          <div
            className="mt-3 p-3 rounded-[var(--radius-input)] text-sm flex flex-col gap-2"
            style={{ background: inviteMessage.ok ? 'var(--success-container)' : 'var(--warning-container)', color: inviteMessage.ok ? 'var(--on-success-container)' : 'var(--on-warning-container)' }}
          >
            <span>{inviteMessage.text}</span>
            {inviteMessage.link && (
              <div className="flex gap-2">
                <input readOnly className={`${inputClass} text-xs`} value={inviteMessage.link} onFocus={e => e.currentTarget.select()} />
                <button type="button" className={buttonSecondaryClass} onClick={() => copyLink(inviteMessage.link!, 'new')}>
                  {copiedId === 'new' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div>
          <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Pending invites</span>
          <div className="flex flex-col gap-2">
            {invites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-2 p-2.5 rounded-[var(--radius-input)]" style={{ background: 'var(--bg-surface-alt)' }}>
                <div className="min-w-0">
                  <span className="block text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inv.email}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ROLE_LABELS[inv.role]} &middot; expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    className="p-1.5 rounded-full transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    title="Copy invite link"
                    onClick={() => copyLink(inviteLink(inv.token), inv.id)}
                  >
                    {copiedId === inv.id ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  <button
                    className="p-1.5 rounded-full transition-colors"
                    style={{ color: 'var(--danger)' }}
                    title="Revoke invite"
                    onClick={() => handleRevokeInvite(inv.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members */}
      <div>
        <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Members</span>
        {roleActionError && (
          <div className="flex items-start gap-1.5 text-sm mb-2" style={{ color: 'var(--danger)' }}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{roleActionError}</span>
          </div>
        )}
        <div className={`overflow-x-auto rounded-[var(--radius-card)] border`} style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">NDA</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {u.name}{u.id === user?.id && <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(you)</span>}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                  <td className="px-3 py-2">
                    {u.role === 'superadmin' ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: 'var(--primary-container)', color: 'var(--on-primary-container)' }}
                        >
                          <Crown size={12} />Super Admin
                        </span>
                        {isSuperAdmin(user?.role) && (
                          <button
                            type="button"
                            className="text-xs px-2 py-0.5 rounded-[var(--radius-input)] transition-colors"
                            style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' }}
                            onClick={() => handleSuperAdminChange(u.id, 'admin')}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          className={`${inputClass} w-auto py-1`}
                          value={u.role}
                          onChange={e => handleRoleChange(u.id, e.target.value as Role)}
                        >
                          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        {isSuperAdmin(user?.role) && u.role === 'admin' && (
                          <button
                            type="button"
                            className="text-xs px-2 py-0.5 rounded-[var(--radius-input)] transition-colors whitespace-nowrap"
                            style={{ background: 'var(--primary-container)', color: 'var(--on-primary-container)' }}
                            onClick={() => handleSuperAdminChange(u.id, 'superadmin')}
                          >
                            <Crown size={12} className="inline -mt-0.5 mr-0.5" />Make Super Admin
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.nda_accepted_version && u.nda_accepted_version === ndaVersion ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: 'var(--success-container)', color: 'var(--on-success-container)' }}
                        title={u.nda_accepted_at ? `Accepted ${new Date(u.nda_accepted_at).toLocaleDateString()}` : undefined}
                      >
                        <ShieldCheck size={12} />Signed
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: 'var(--warning-container)', color: 'var(--on-warning-container)' }}
                        title={u.nda_accepted_version ? 'Accepted an earlier version - not yet re-signed' : 'Has not signed yet'}
                      >
                        <ShieldAlert size={12} />{u.nda_accepted_version ? 'Outdated' : 'Not signed'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="p-1.5 rounded-full transition-colors"
                      style={{ color: 'var(--danger)' }}
                      title="Remove from team"
                      onClick={() => handleRemoveUser(u.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SuperAdminRecovery admins={users.filter(u => u.role === 'admin')} />
    </section>
  );
}
