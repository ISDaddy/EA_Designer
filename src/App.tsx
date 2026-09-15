import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  ConnectionMode,
  Handle,
  Position,
  applyNodeChanges,
} from '@xyflow/react';
import type { Connection, Edge, Node, NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Calendar, Component, Eye, LogOut, MousePointerClick, Plus, Search, Settings as SettingsIcon, Table, Trash2, Workflow, X } from 'lucide-react';
import { useTheme } from './theme/useTheme';
import { SettingsView } from './theme/SettingsView';
import { apiFetch } from './api';
import { useAuth } from './auth/useAuth';
import { useI18n } from './i18n/useI18n';
import { TIME_ZONE_OPTIONS, detectBrowserTimeZone, timeZoneLabel, formatInTimeZone } from './i18n/timezone';
import { AuthGate } from './auth/AuthGate';
import { NdaGate } from './auth/NdaGate';
import { canEdit } from './auth/roles';
import { inputClass, buttonPrimaryClass, buttonDangerClass, buttonSecondaryClass, cardClass, panelHeadingClass, labelClass, listItemCardClass } from './ui';
import { LogoMark } from './LogoMark';
import { computeNextOccurrences, describeSchedule, DAY_NAMES, type ScheduleDef } from './schedule';
import { logAuditView } from './audit/logView';

// Renders as an ArchiMate-notation application component under the "Enterprise Architecture"
// style, or as a rounded tonal card under "Material 3 Expressive" - the two styles differ in more
// than color, so the node itself branches on the current style rather than just swapping a palette.
const EASystemNode = ({ data }: { data: SystemNodeData }) => {
  const { style } = useTheme();
  const isM3 = style === 'm3';

  return (
    <div
      className={`relative min-w-[160px] min-h-[64px] flex items-center justify-center p-3 group transition-all duration-200 ${
        isM3
          ? 'rounded-[var(--radius-node)] border-[1.5px] hover:-translate-y-0.5'
          : 'rounded-[var(--radius-node)] border-2'
      }`}
      style={{
        background: 'var(--node-bg)',
        borderColor: data.isHighlighted ? 'var(--selection)' : 'var(--node-border)',
        color: 'var(--node-text)',
        boxShadow: data.isHighlighted
          ? `0 0 0 3px var(--selection-glow), var(--shadow-md)`
          : 'var(--shadow-sm)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = data.isHighlighted ? `0 0 0 3px var(--selection-glow), var(--shadow-lg)` : 'var(--shadow-lg)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = data.isHighlighted ? `0 0 0 3px var(--selection-glow), var(--shadow-md)` : 'var(--shadow-sm)'; }}
    >
      {isM3 ? (
        <div
          className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: 'var(--node-border)', opacity: 0.18 }}
        >
          <Component size={13} style={{ color: 'var(--node-text)', opacity: 1 }} />
        </div>
      ) : (
        <>
          {/* ArchiMate Application Component icon hint (two small boxes on top-left) */}
          <div className="absolute top-1 left-1 flex flex-col gap-0.5">
            <div className="w-2 h-1 border" style={{ borderColor: 'var(--node-border)' }}></div>
            <div className="w-2 h-1 border" style={{ borderColor: 'var(--node-border)' }}></div>
          </div>
          <div className="absolute top-1 left-2.5 w-3 h-2.5 border" style={{ borderColor: 'var(--node-border)' }}></div>
        </>
      )}

      {data.criticality === 'critical' && (
        <div
          className={isM3 ? 'absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full' : 'absolute -top-2 -right-2 w-4 h-4 rounded-full border-2'}
          style={{ background: 'var(--critical-dot)', borderColor: isM3 ? undefined : 'var(--bg-surface)', boxShadow: isM3 ? '0 0 0 2px var(--bg-surface)' : undefined }}
          title="Critical system"
        />
      )}

      <div className={`font-bold text-center whitespace-pre-wrap px-1 ${isM3 ? 'mt-1 text-[15px]' : 'mt-2'}`}>{data.label}</div>
      {data.status && data.status !== 'active' && (
        <div
          className={isM3 ? 'absolute bottom-1.5 right-1.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full' : 'absolute bottom-1 right-1 text-[9px] font-bold uppercase px-1 rounded'}
          style={{ color: 'var(--node-text)', background: isM3 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)' }}
        >
          {data.status}
        </div>
      )}

      {/* Multiple invisible connection ports dynamically snapped to by the custom routing logic */}
      {[Position.Top, Position.Bottom, Position.Left, Position.Right].map(pos =>
        [50, 25, 75, 10, 90, 40, 60].map(pct => {
          const isVertical = pos === Position.Top || pos === Position.Bottom;
          const posStyle = isVertical ? { left: `${pct}%` } : { top: `${pct}%` };
          // The center handle (50) is visible, the others are invisible grid anchors
          const isCenter = pct === 50;
          return (
            <React.Fragment key={`${pos}-${pct}`}>
              <Handle
                type="target"
                position={pos}
                id={`t-${pos}-${pct}`}
                style={{...posStyle, zIndex: 0}}
                className="opacity-0 w-1 h-1 absolute pointer-events-none"
              />
              <Handle
                type="source"
                position={pos}
                id={`s-${pos}-${pct}`}
                style={{...posStyle, zIndex: 1, background: isCenter ? 'var(--node-border)' : undefined, borderColor: isCenter ? 'var(--bg-surface)' : undefined}}
                className={isCenter ? "w-2 h-2 border-2 rounded-full opacity-50 group-hover:opacity-100 transition-opacity" : "opacity-0 w-1 h-1"}
              />
            </React.Fragment>
          );
        })
      )}
    </div>
  );
};

const JunctionNode = () => (
  <div className="rounded-full w-3 h-3 shadow border-2 relative" style={{ background: 'var(--junction-color)', borderColor: 'var(--bg-surface)' }}>
    <Handle type="target" position={Position.Top} className="opacity-0 absolute inset-0 w-full h-full pointer-events-none" id={`t-${Position.Top}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    <Handle type="source" position={Position.Top} className="opacity-0 absolute inset-0 w-full h-full" id={`s-${Position.Top}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    <Handle type="target" position={Position.Bottom} className="opacity-0 absolute inset-0 w-full h-full pointer-events-none" id={`t-${Position.Bottom}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    <Handle type="source" position={Position.Bottom} className="opacity-0 absolute inset-0 w-full h-full" id={`s-${Position.Bottom}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    <Handle type="target" position={Position.Left} className="opacity-0 absolute inset-0 w-full h-full pointer-events-none" id={`t-${Position.Left}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    <Handle type="source" position={Position.Left} className="opacity-0 absolute inset-0 w-full h-full" id={`s-${Position.Left}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    <Handle type="target" position={Position.Right} className="opacity-0 absolute inset-0 w-full h-full pointer-events-none" id={`t-${Position.Right}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    <Handle type="source" position={Position.Right} className="opacity-0 absolute inset-0 w-full h-full" id={`s-${Position.Right}-50`} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
  </div>
);

const nodeTypes = {
  eaSystem: EASystemNode,
  junction: JunctionNode,
};

type SystemStatus = 'planned' | 'active' | 'deprecated' | 'retired';
type Criticality = 'low' | 'medium' | 'high' | 'critical';
type DataObjectClassification = 'public' | 'internal' | 'confidential' | 'restricted';
// What one data object is called - and identified by - within a particular system. The same
// logical object very often has a different name in each system, and each system tracks it under
// its own object id, so this is keyed per system rather than being a single global value.
type SystemObjectName = { name: string; objectId?: string };

type SystemNodeData = {
  label: string;
  layoutPositions?: Record<string, { x: number; y: number }>;
  isHighlighted?: boolean;
  ownerIds?: string[];
  status?: SystemStatus;
  criticality?: Criticality;
  businessCapability?: string;
  techStack?: string[];
  description?: string;
  timeZone?: string;
};

type SystemNode = Node<SystemNodeData, 'eaSystem'> | Node<Record<string, never>, 'junction'>;
type IntegrationEdgeData = {
  dataObjectIds: string[];
  description?: string;
  ownerIds?: string[];
};
type IntegrationEdge = Edge<IntegrationEdgeData>;

// An admin-maintainable tag (Inventory page) that an integration can carry one or more of -
// shared shape for both the Integration Type list (Manual, API Integration, ...) and the
// Integration Software list (Middleware, P2P, ...).
// `timeZone` only ever applies to Integration Software entries - a shared tool like "Boomi" runs
// out of one place, so every connection tagged with it shares that one time zone.
type ReferenceListItem = { id: string; name: string; timeZone?: string };

// A minimal, non-admin-only view of a team member - just enough to populate an owner picker for
// systems/integrations, as opposed to the full admin-only user-management record (role, invite
// history, ...) from /api/users.
type TeamRosterUser = { id: string; name: string; email: string };
type ReferenceListId = 'integration-types' | 'integration-software';

// Every flow's frequency, unlike Integration Type/Software, isn't a shared admin-maintained tag -
// each (edge, object) flow defines its own cadence directly, and every flow must have one (it's
// not optional the way the type/software tags are). "none" still means something real here
// (real-time/on-demand, no fixed cadence) rather than "not configured" - the field itself is what
// can't be left unset.
const DEFAULT_SCHEDULE: ScheduleDef = { kind: 'daily', time: '02:00' };

// How a single data object moves over a single connection - one of these per (edge, object)
// pair, not per edge, since a connection carrying several objects can integrate each one
// differently (see the comment by INTEGRATION_PATTERN_OPTIONS above for why the pattern is
// further split into a source-side and target-side value). `atRisk` flags a flow whose business
// impact is high enough that an interrupted schedule/connection should be called out on the
// Schedule page rather than blending in with routine traffic.
type EdgeObjectDetail = {
  sourcePattern?: string;
  targetPattern?: string;
  schedule?: ScheduleDef;
  integrationTypeId?: string;
  integrationSoftwareId?: string;
  atRisk?: boolean;
};
const edgeObjectDetailKey = (edgeId: string, objectId: string) => `${edgeId}::${objectId}`;

// Which single-valued EdgeObjectDetail field a given reference list actually populates - a flow
// carries at most one Integration Type and one Integration Software, never several - used to find
// (and later resolve) every place an entry is referenced before it can be deleted. Frequency isn't
// a reference list any more, so it has no entry here.
const REFERENCE_LIST_FIELD: Record<ReferenceListId, 'integrationTypeId' | 'integrationSoftwareId'> = {
  'integration-types': 'integrationTypeId',
  'integration-software': 'integrationSoftwareId',
};

// One (edge, object) flow that currently tags itself with the reference-list item a user is
// trying to delete - what ReferenceItemDeleteDialog shows so the deletion can't silently leave
// dangling ids behind.
type ReferenceItemUsage = {
  key: string;
  edgeId: string;
  objectId: string;
  edgeLabel: string;
  objectName: string;
};

// A planned or unplanned window where a system is unavailable - the Schedule page cross-
// references these against computed run times to flag which integrations they'd impact.
type SystemDowntime = { id: string; systemId: string; startsAt: string; endsAt: string; reason?: string };

// `nodes.filter(n => n.type === 'eaSystem')` doesn't narrow the array's element type (only a type
// predicate does), so call sites used to fall back to `as any` to reach `.data.label`. This guard
// lets them narrow properly instead.
const isEaSystemNode = (n: Node | null | undefined): n is Node<SystemNodeData, 'eaSystem'> =>
  !!n && n.type === 'eaSystem';

// Every data object mastered by, or flowing in/out of, a given system - shared by the canvas
// sidebar's System Details panel and the Inventory page's own copy of it.
const objectsForSystem = (systemId: string | null, dataObjects: DataObject[], edges: IntegrationEdge[]): DataObject[] => {
  if (!systemId) return [];
  const relatedIds = new Set<string>();
  dataObjects.forEach(o => { if (o.masterSystemId === systemId) relatedIds.add(o.id); });
  edges.forEach(e => {
    if (e.source === systemId || e.target === systemId) {
      e.data?.dataObjectIds?.forEach(id => relatedIds.add(id));
    }
  });
  return dataObjects.filter(o => relatedIds.has(o.id));
};

type RawSystemRow = {
  id: string; label: string; x: number; y: number;
  layout_positions?: Record<string, { x: number; y: number }>;
  status?: string; criticality?: string;
  business_capability?: string; tech_stack?: string[]; description?: string; time_zone?: string;
  owner_ids?: string[];
};
type RawDataObjectRow = {
  id: string; name: string; master_system_id: string;
  system_object_names?: Record<string, SystemObjectName>; description?: string; classification?: string;
};
type RawEdgeRow = {
  id: string; source: string; target: string; data_object_ids: string[];
  description?: string; owner_ids?: string[];
};
type RawEdgeObjectDetailRow = {
  edge_id: string; data_object_id: string;
  source_pattern?: string; target_pattern?: string; schedule?: ScheduleDef;
  integration_type_id?: string; integration_software_id?: string; at_risk?: boolean;
};
type RawSystemDowntimeRow = {
  id: string; system_id: string; starts_at: string; ends_at: string; reason?: string;
};

type DataObject = {
  id: string;
  name: string;
  masterSystemId: string;
  systemObjectNames?: Record<string, SystemObjectName>; // systemId -> name/objectId in that system
  description?: string;
  classification?: DataObjectClassification;
};

// One concrete future run of one object's flow over one connection, expanded from that flow's
// assigned frequencies - the Schedule page's whole reason for existing (see schedule.ts for how
// a frequency's structured `schedule` becomes actual timestamps).
type ScheduledRun = {
  key: string;
  time: Date;
  objectName: string;
  edgeId: string;
  sourceSystemId: string;
  targetSystemId: string;
  sourceLabel: string;
  targetLabel: string;
  sourceTimeZone: string;
  targetTimeZone: string;
  frequencyLabel: string;
  atRisk: boolean;
  impactedDowntimes: SystemDowntime[];
};

const SCHEDULE_WINDOW_DAYS = 30;
const MAX_OCCURRENCES_PER_FLOW = 30;

function computeScheduledRuns(
  edges: IntegrationEdge[],
  dataObjects: DataObject[],
  edgeObjectDetails: Record<string, EdgeObjectDetail>,
  systemDowntimes: SystemDowntime[],
  getSystemLabel: (id: string | null | undefined) => string | undefined,
  getSystemTimeZone: (id: string | null | undefined) => string,
): ScheduledRun[] {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + SCHEDULE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const results: ScheduledRun[] = [];

  edges.forEach(edge => {
    const objIds = edge.data?.dataObjectIds || [];
    objIds.forEach(objId => {
      const detail = edgeObjectDetails[edgeObjectDetailKey(edge.id, objId)];
      const schedule = detail?.schedule || DEFAULT_SCHEDULE;
      if (schedule.kind === 'none') return;
      const obj = dataObjects.find(o => o.id === objId);
      if (!obj) return;

      const occurrences = computeNextOccurrences(schedule, now, MAX_OCCURRENCES_PER_FLOW)
        .filter(d => d <= horizonEnd);

      occurrences.forEach((time, i) => {
        const impactedDowntimes = systemDowntimes.filter(dt =>
          (dt.systemId === edge.source || dt.systemId === edge.target) &&
          time >= new Date(dt.startsAt) && time <= new Date(dt.endsAt)
        );
        results.push({
          key: `${edge.id}-${objId}-${i}`,
          time,
          objectName: obj.name,
          edgeId: edge.id,
          sourceSystemId: edge.source,
          targetSystemId: edge.target,
          sourceLabel: getSystemLabel(edge.source) || edge.source,
          targetLabel: getSystemLabel(edge.target) || edge.target,
          sourceTimeZone: getSystemTimeZone(edge.source),
          targetTimeZone: getSystemTimeZone(edge.target),
          frequencyLabel: describeSchedule(schedule),
          atRisk: !!detail?.atRisk,
          impactedDowntimes,
        });
      });
    });
  });

  return results.sort((a, b) => a.time.getTime() - b.time.getTime());
}

const STATUS_LABELS: Record<SystemStatus, string> = { planned: 'Planned', active: 'Active', deprecated: 'Deprecated', retired: 'Retired' };
const STATUS_BADGE_STYLES: Record<string, string> = {
  planned: 'bg-[var(--info-container)] text-[var(--on-info-container)]',
  active: 'bg-[var(--success-container)] text-[var(--on-success-container)]',
  deprecated: 'bg-[var(--warning-container)] text-[var(--on-warning-container)]',
  retired: 'bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]',
};
const CRITICALITY_LABELS: Record<Criticality, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const CRITICALITY_BADGE_STYLES: Record<string, string> = {
  low: 'bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]',
  medium: 'bg-[var(--info-container)] text-[var(--on-info-container)]',
  high: 'bg-[var(--warning-container)] text-[var(--on-warning-container)]',
  critical: 'bg-[var(--danger-container)] text-[var(--on-danger-container)]',
};
const CLASSIFICATION_LABELS: Record<DataObjectClassification, string> = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };
const CLASSIFICATION_BADGE_STYLES: Record<string, string> = {
  public: 'bg-[var(--success-container)] text-[var(--on-success-container)]',
  internal: 'bg-[var(--info-container)] text-[var(--on-info-container)]',
  confidential: 'bg-[var(--warning-container)] text-[var(--on-warning-container)]',
  restricted: 'bg-[var(--danger-container)] text-[var(--on-danger-container)]',
};

// The mechanics of how a single data object moves over a connection - kept per (edge, object)
// rather than per edge, because a connection carrying several objects can integrate each one
// differently. The pattern is further split per leg: the same object's flow can, for instance,
// be read from its source system over REST but delivered into its target system via SOAP.
const INTEGRATION_PATTERN_OPTIONS: [string, string][] = [
  ['rest-api', 'REST API'],
  ['soap-api', 'SOAP API'],
  ['message-queue', 'Message Queue / Kafka'],
  ['file-transfer', 'File Transfer (SFTP/etc.)'],
  ['database', 'Direct Database'],
  ['manual', 'Manual'],
  ['other', 'Other'],
];


// A small anchored popover - used to tuck one-off creation forms (Add System, Add Object) behind
// a single button instead of leaving their inputs permanently open in the header, which is what
// made the toolbar feel cluttered on every page regardless of whether you were using it.
function Popover({ trigger, children, align = 'left' }: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // `Node` (the DOM type) is shadowed in this file by React Flow's own `Node` type import, so
    // narrow via `HTMLElement` instead of casting to it directly.
    const onClick = (e: MouseEvent) => { if (ref.current && e.target instanceof HTMLElement && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div
          className={`absolute mt-2 ${align === 'right' ? 'right-0' : 'left-0'} w-72 max-w-[calc(100vw-2rem)] rounded-[var(--radius-card)] shadow-[var(--shadow-lg)] border z-50 p-4`}
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// A filterable, paginated table over the systems the backend holds - the practical way to browse
// a landscape of hundreds or thousands of systems, since rendering that many boxes on one canvas
// stops being usable long before a real enterprise's system count does.
type InventoryRow = {
  id: string; label: string; status: string; criticality: string;
  business_capability: string; description: string; time_zone: string; owner_ids: string[];
};

// The system editor - shown in the canvas sidebar when a node is selected, and reused verbatim by
// the Inventory page's own details panel so editing a system works identically from either place.
function SystemDetailsPanel({
  systemId, data, objectsInSystem, renameSystem, updateSystemField, setSystemObjectName, deleteObject, onDelete, readOnly,
  teamRoster, canManageOwners,
}: {
  systemId: string;
  data: SystemNodeData | undefined;
  objectsInSystem: DataObject[];
  renameSystem: (sysId: string, newLabel: string) => void;
  updateSystemField: <K extends keyof SystemNodeData>(sysId: string, field: K, value: SystemNodeData[K], debounceKey?: string) => void;
  setSystemObjectName: (objId: string, sysId: string, entry: SystemObjectName) => void;
  deleteObject: (objId: string) => void;
  onDelete: () => void;
  readOnly?: boolean;
  teamRoster: TeamRosterUser[];
  canManageOwners: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <h2 className={panelHeadingClass}>{t('system.details.title')}</h2>
      <div>
        <label className={labelClass}>{t('system.details.name')}</label>
        <input
          type="text"
          className={inputClass}
          value={data?.label || ''}
          disabled={readOnly}
          onChange={(e) => renameSystem(systemId, e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>{t('system.details.status')}</label>
          <select
            className={inputClass}
            value={data?.status || 'active'}
            disabled={readOnly}
            onChange={(e) => updateSystemField(systemId, 'status', e.target.value as SystemStatus)}
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('system.details.criticality')}</label>
          <select
            className={inputClass}
            value={data?.criticality || 'medium'}
            disabled={readOnly}
            onChange={(e) => updateSystemField(systemId, 'criticality', e.target.value as Criticality)}
          >
            {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <div>
        <OwnerPicker
          ownerIds={data?.ownerIds || []}
          roster={teamRoster}
          canManage={canManageOwners}
          onChange={(ids) => updateSystemField(systemId, 'ownerIds', ids)}
        />
      </div>

      <div>
        <label className={labelClass}>{t('system.details.businessCapability')}</label>
        <input
          type="text"
          className={inputClass}
          placeholder="e.g. Order to Cash"
          value={data?.businessCapability || ''}
          disabled={readOnly}
          onChange={(e) => updateSystemField(systemId, 'businessCapability', e.target.value, `system-capability-${systemId}`)}
        />
      </div>

      <div>
        <label className={labelClass}>{t('system.details.timeZone')}</label>
        <select
          className={inputClass}
          value={data?.timeZone || 'UTC'}
          disabled={readOnly}
          onChange={(e) => updateSystemField(systemId, 'timeZone', e.target.value)}
        >
          {(TIME_ZONE_OPTIONS.includes(data?.timeZone || 'UTC') ? TIME_ZONE_OPTIONS : [data?.timeZone || 'UTC', ...TIME_ZONE_OPTIONS]).map(tz => (
            <option key={tz} value={tz}>{timeZoneLabel(tz)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>{t('system.details.techStack')}</label>
        <input
          type="text"
          className={inputClass}
          placeholder="e.g. Java, PostgreSQL, AWS"
          value={(data?.techStack || []).join(', ')}
          disabled={readOnly}
          onChange={(e) => updateSystemField(
            systemId, 'techStack',
            e.target.value.split(',').map(s => s.trim()).filter(Boolean),
            `system-stack-${systemId}`
          )}
        />
      </div>

      <div>
        <label className={labelClass}>{t('system.details.description')}</label>
        <textarea
          className={inputClass}
          rows={3}
          placeholder="What does this system do?"
          value={data?.description || ''}
          disabled={readOnly}
          onChange={(e) => updateSystemField(systemId, 'description', e.target.value, `system-desc-${systemId}`)}
        />
      </div>

      <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <h3 className="font-bold text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{t('system.details.objectsInSystem')}</h3>
        {objectsInSystem.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('system.details.noObjects')}</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-[30vh] overflow-y-auto pr-1">
            {(() => {
              const renderObjectRow = (obj: DataObject) => {
                const entry = obj.systemObjectNames?.[systemId];
                const name = entry?.name || '';
                const objectId = entry?.objectId || '';
                return (
                  <div key={obj.id} className={`${listItemCardClass} text-xs px-2 py-1 flex flex-col gap-1`}>
                    <div className="flex items-center justify-between">
                      <span className="truncate pr-2 font-bold" style={{ color: 'var(--text-secondary)' }} title={obj.name}>{obj.name}</span>
                      {obj.masterSystemId === systemId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'var(--primary-container)', color: 'var(--on-primary-container)' }}>{t('common.master')}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <input
                        type="text"
                        className={`${inputClass} px-1.5 py-0.5 text-xs`}
                        placeholder={t('system.details.nameInSystem')}
                        value={name}
                        disabled={readOnly}
                        onChange={(e) => setSystemObjectName(obj.id, systemId, { name: e.target.value, objectId })}
                      />
                      <input
                        type="text"
                        className={`${inputClass} px-1.5 py-0.5 text-xs`}
                        placeholder={t('system.details.objectIdInSystem')}
                        value={objectId}
                        disabled={readOnly}
                        onChange={(e) => setSystemObjectName(obj.id, systemId, { name, objectId: e.target.value })}
                      />
                      {!readOnly && (
                        <button
                          className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-input)] shrink-0 transition-colors"
                          style={{ background: 'var(--danger-container)', color: 'var(--on-danger-container)' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteObject(obj.id);
                          }}
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              };

              const rendered = new Set<string>();
              const items: React.ReactElement[] = [];
              for (const obj of objectsInSystem) {
                if (rendered.has(obj.id)) continue;
                const name = obj.systemObjectNames?.[systemId]?.name?.trim();
                const groupMembers = name
                  ? objectsInSystem.filter(o => (o.systemObjectNames?.[systemId]?.name?.trim()) === name)
                  : [obj];
                groupMembers.forEach(o => rendered.add(o.id));

                if (groupMembers.length > 1) {
                  items.push(
                    <div key={`group-${name}`} className="rounded-[var(--radius-input)] border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'var(--bg-surface-alt)' }}>
                        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('system.details.recordType')}</span>
                        <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-auto" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>{groupMembers.length}</span>
                      </div>
                      <div className="flex flex-col gap-1 p-1">
                        {groupMembers.map(o => renderObjectRow(o))}
                      </div>
                    </div>
                  );
                } else {
                  items.push(renderObjectRow(obj));
                }
              }
              return items;
            })()}
          </div>
        )}
      </div>

      {!readOnly && (
        <button className={`${buttonDangerClass} mt-8`} onClick={onDelete}>
          <Trash2 size={14} />{t('system.details.deleteSystem')}
        </button>
      )}
    </>
  );
}

// The data object editor - same idea as SystemDetailsPanel: one implementation shared by the
// canvas sidebar and the Inventory page.
function ObjectDetailsPanel({
  object, systemNodes, getSystemLabel, onBack, renameObjectGlobal, updateObjectField, setSystemObjectName, onDelete, readOnly,
}: {
  object: DataObject;
  systemNodes: SystemNode[];
  getSystemLabel: (id: string | null | undefined) => string | undefined;
  onBack: () => void;
  renameObjectGlobal: (objId: string, newName: string) => void;
  updateObjectField: <K extends keyof DataObject>(objId: string, field: K, value: DataObject[K], debounceKey?: string) => void;
  setSystemObjectName: (objId: string, sysId: string, entry: SystemObjectName) => void;
  onDelete: () => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <button className="text-xs text-left mb-2 hover:underline" style={{ color: 'var(--primary)' }} onClick={onBack}>
        &larr; {t('common.close')}
      </button>
      <h2 className={panelHeadingClass}>{t('object.details.title')}</h2>

      <div className="mt-2">
        <label className={labelClass}>{t('object.details.globalName')}</label>
        <input
          type="text"
          className={inputClass}
          value={object.name}
          disabled={readOnly}
          onChange={(e) => renameObjectGlobal(object.id, e.target.value)}
        />
      </div>

      <div className="mt-4">
        <label className={labelClass}>{t('object.details.classification')}</label>
        <select
          className={inputClass}
          value={object.classification || 'internal'}
          disabled={readOnly}
          onChange={(e) => updateObjectField(object.id, 'classification', e.target.value as DataObjectClassification)}
        >
          <option value="public">{t('classification.public')}</option>
          <option value="internal">{t('classification.internal')}</option>
          <option value="confidential">{t('classification.confidential')}</option>
          <option value="restricted">{t('classification.restricted')}</option>
        </select>
      </div>

      <div className="mt-4">
        <label className={labelClass}>{t('object.details.description')}</label>
        <textarea
          className={inputClass}
          rows={2}
          value={object.description || ''}
          disabled={readOnly}
          onChange={(e) => updateObjectField(object.id, 'description', e.target.value, `object-desc-${object.id}`)}
        />
      </div>

      <div className="mt-4">
        <label className={labelClass}>{t('object.details.masterSystem')}</label>
        <select
          className={inputClass}
          value={object.masterSystemId || ''}
          disabled={readOnly}
          onChange={(e) => updateObjectField(object.id, 'masterSystemId', e.target.value)}
        >
          <option value="" disabled>{t('object.details.selectSystem')}</option>
          {systemNodes.filter(isEaSystemNode).map(n => <option key={n.id} value={n.id}>{n.data.label}</option>)}
        </select>
      </div>

      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <h3 className="font-bold text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{t('object.details.systemObjectNames')}</h3>
        {Object.entries(object.systemObjectNames || {}).length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('object.details.noSystemObjectNames')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {Object.entries(object.systemObjectNames || {}).map(([sysId, entry]) => {
              const sysName = getSystemLabel(sysId) || 'Unknown System';
              return (
                <div key={sysId} className={`${listItemCardClass} flex flex-col gap-1`}>
                  <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{sysName}</span>
                  <input
                    type="text"
                    className={`${inputClass} px-1.5 py-0.5 text-xs`}
                    placeholder={t('system.details.nameInSystem')}
                    value={entry.name}
                    disabled={readOnly}
                    onChange={(e) => setSystemObjectName(object.id, sysId, { name: e.target.value, objectId: entry.objectId })}
                  />
                  <input
                    type="text"
                    className={`${inputClass} px-1.5 py-0.5 text-xs`}
                    placeholder={t('system.details.objectIdInSystem')}
                    value={entry.objectId || ''}
                    disabled={readOnly}
                    onChange={(e) => setSystemObjectName(object.id, sysId, { name: entry.name, objectId: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!readOnly && (
        <button className={`${buttonDangerClass} mt-8`} onClick={onDelete}>
          <Trash2 size={14} />{t('object.details.deleteObject')}
        </button>
      )}
    </>
  );
}

// One admin-maintainable {id, name} list (Integration Types or Integration Software), rendered
// as a card with inline rename/delete per row and an add-new row at the bottom. Used twice from
// ReferenceListsPanel - one instance per list - since both lists share the exact same shape.
function ReferenceListCard({
  title, blurb, items, list, onAdd, onRename, onDelete, onUpdateTimeZone, canWrite,
}: {
  title: string;
  blurb: string;
  items: ReferenceListItem[];
  list: ReferenceListId;
  onAdd: (list: ReferenceListId, name: string) => void;
  onRename: (list: ReferenceListId, id: string, name: string) => void;
  onDelete: (list: ReferenceListId, id: string) => void;
  onUpdateTimeZone?: (id: string, timeZone: string) => void;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const [newName, setNewName] = useState('');

  const submitAdd = () => {
    if (!newName.trim()) return;
    onAdd(list, newName);
    setNewName('');
  };

  return (
    <div className={`${cardClass} p-4 flex-1 min-w-[260px]`}>
      <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{blurb}</p>

      <div className="flex flex-col gap-1.5">
        {items.map(item => (
          <div key={item.id} className={`${listItemCardClass} flex flex-col gap-1.5 px-2 py-1`}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className={`${inputClass} px-1.5 py-1 text-sm`}
                value={item.name}
                disabled={!canWrite}
                onChange={(e) => onRename(list, item.id, e.target.value)}
              />
              {canWrite && (
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-input)] shrink-0 transition-colors"
                  style={{ background: 'var(--danger-container)', color: 'var(--on-danger-container)' }}
                  onClick={() => onDelete(list, item.id)}
                >
                  {t('common.delete')}
                </button>
              )}
            </div>
            {onUpdateTimeZone && (
              <select
                className={`${inputClass} px-1.5 py-1 text-xs`}
                value={item.timeZone || 'UTC'}
                disabled={!canWrite}
                onChange={(e) => onUpdateTimeZone(item.id, e.target.value)}
              >
                {(TIME_ZONE_OPTIONS.includes(item.timeZone || 'UTC') ? TIME_ZONE_OPTIONS : [item.timeZone || 'UTC', ...TIME_ZONE_OPTIONS]).map(tz => (
                  <option key={tz} value={tz}>{timeZoneLabel(tz)}</option>
                ))}
              </select>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.noEntriesYet')}</p>}
      </div>

      {canWrite && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <input
            type="text"
            className={`${inputClass} text-sm`}
            placeholder={t('common.addNew')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); }}
          />
          <button className={buttonSecondaryClass} onClick={submitAdd}>
            <Plus size={14} />{t('common.add')}
          </button>
        </div>
      )}
    </div>
  );
}

// Who owns a system or integration - a list of real user accounts (not free text, so an owner
// change can actually email the people it affects) shown as removable chips plus an "add" picker.
// `canManage` is passed in by the caller rather than recomputed here, since it depends on whether
// the viewer is an admin/editor OR is themselves already one of this resource's owners - either is
// enough to manage that one resource's owner list, even for someone who can't edit anything else
// about it (see isOwnerManagingOwnersOnly server-side).
function OwnerPicker({
  ownerIds, roster, canManage, onChange,
}: {
  ownerIds: string[];
  roster: TeamRosterUser[];
  canManage: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const rosterById = useMemo(() => Object.fromEntries(roster.map(u => [u.id, u])), [roster]);
  const nameOf = (id: string) => rosterById[id]?.name || rosterById[id]?.email || id;

  return (
    <div>
      <label className={labelClass}>{t('owners.label')}</label>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {ownerIds.map(id => (
          <span
            key={id}
            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full"
            style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' }}
          >
            {nameOf(id)}
            {canManage && (
              <button
                className="rounded-full transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => onChange(ownerIds.filter(x => x !== id))}
                aria-label={`Remove ${nameOf(id)}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {ownerIds.length === 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('owners.none')}</span>}
      </div>
      {canManage && (
        <select
          className={`${inputClass} text-xs`}
          value=""
          onChange={(e) => { if (e.target.value) onChange([...ownerIds, e.target.value]); }}
        >
          <option value="">{t('owners.addOwner')}</option>
          {roster.filter(u => !ownerIds.includes(u.id)).map(u => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
      )}
      {ownerIds.length === 1 && (
        <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--warning)' }}>
          <AlertTriangle size={11} />{t('owners.singleOwnerWarning')}
        </p>
      )}
    </div>
  );
}

// A structured schedule editor (real-time / cron / every-N-minutes / daily / weekly) for one
// flow's mandatory frequency. Frequency used to be an admin-maintained list a flow picked entries
// from; now each (edge, object) flow just defines its own cadence directly, so this is the only
// place a schedule is ever edited.
function ScheduleEditor({
  schedule, onChange, canWrite,
}: {
  schedule: ScheduleDef;
  onChange: (schedule: ScheduleDef) => void;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const dayToggleClass = "w-6 h-6 text-[10px] font-bold rounded-full border transition-colors";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <select
          className={`${inputClass} px-1.5 py-1 text-xs w-auto`}
          value={schedule.kind}
          disabled={!canWrite}
          onChange={(e) => {
            const kind = e.target.value as ScheduleDef['kind'];
            const next: ScheduleDef =
              kind === 'cron' ? { kind: 'cron', expression: '0 * * * *' } :
              kind === 'interval' ? { kind: 'interval', everyMinutes: 60 } :
              kind === 'daily' ? { kind: 'daily', time: '02:00' } :
              kind === 'weekly' ? { kind: 'weekly', time: '02:00', daysOfWeek: [0] } :
              { kind: 'none' };
            onChange(next);
          }}
        >
          <option value="none">{t('scheduleDef.none')}</option>
          <option value="cron">{t('scheduleDef.cron')}</option>
          <option value="interval">{t('scheduleDef.interval')}</option>
          <option value="daily">{t('scheduleDef.daily')}</option>
          <option value="weekly">{t('scheduleDef.weekly')}</option>
        </select>

        {schedule.kind === 'cron' && (
          <input
            type="text"
            className={`${inputClass} px-1.5 py-1 text-xs w-32`}
            placeholder="0 * * * *"
            value={schedule.expression}
            disabled={!canWrite}
            onChange={(e) => onChange({ kind: 'cron', expression: e.target.value })}
          />
        )}

        {schedule.kind === 'interval' && (
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{t('scheduleDef.every')}</span>
            <input
              type="number"
              min={1}
              className={`${inputClass} px-1.5 py-1 text-xs w-16`}
              value={schedule.everyMinutes}
              disabled={!canWrite}
              onChange={(e) => onChange({ kind: 'interval', everyMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
            <span>{t('scheduleDef.min')}</span>
          </div>
        )}

        {schedule.kind === 'daily' && (
          <input
            type="time"
            className={`${inputClass} px-1.5 py-1 text-xs w-auto`}
            value={schedule.time}
            disabled={!canWrite}
            onChange={(e) => onChange({ kind: 'daily', time: e.target.value })}
          />
        )}

        {schedule.kind === 'weekly' && (
          <>
            <input
              type="time"
              className={`${inputClass} px-1.5 py-1 text-xs w-auto`}
              value={schedule.time}
              disabled={!canWrite}
              onChange={(e) => onChange({ kind: 'weekly', time: e.target.value, daysOfWeek: schedule.daysOfWeek })}
            />
            <div className="flex gap-0.5">
              {DAY_NAMES.map((d, i) => {
                const active = schedule.daysOfWeek.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!canWrite}
                    className={dayToggleClass}
                    style={active
                      ? { background: 'var(--primary-container)', color: 'var(--on-primary-container)', borderColor: 'var(--primary)' }
                      : { background: 'var(--bg-surface)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                    title={d}
                    onClick={() => {
                      const days = active ? schedule.daysOfWeek.filter(x => x !== i) : [...schedule.daysOfWeek, i];
                      onChange({ kind: 'weekly', time: schedule.time, daysOfWeek: days });
                    }}
                  >
                    {d[0]}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{describeSchedule(schedule)}</span>
    </div>
  );
}

// Gatekeeper in front of every reference-list deletion (Integration Types/Software/Frequencies):
// deleting one of these can silently leave a connection's flow pointing at nothing, so it never
// happens with a single click. With no usages it's still a real, styled confirmation rather than
// a plain browser alert; with usages it forces a decision - replace every usage with one other
// value in one go, or step through and resolve each flow individually - before the delete proceeds.
function ReferenceItemDeleteDialog({
  item, otherItems, usages, onCancel, onConfirm,
}: {
  item: ReferenceListItem;
  otherItems: ReferenceListItem[];
  usages: ReferenceItemUsage[];
  onCancel: () => void;
  onConfirm: (resolutions: Record<string, string | null>) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'choose' | 'replaceAll' | 'individual'>('choose');
  const [replaceAllId, setReplaceAllId] = useState<string>(otherItems[0]?.id || '');
  const [perUsageChoice, setPerUsageChoice] = useState<Record<string, string>>(
    () => Object.fromEntries(usages.map(u => [u.key, '']))
  );

  const hasUsages = usages.length > 0;

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center backdrop-blur-sm p-4">
      <div className={`${cardClass} p-6 w-[28rem] max-w-full flex flex-col gap-4`}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
            {t('refDelete.title', { name: item.name })}
          </h3>
          <button className="p-1 rounded-full transition-colors" style={{ color: 'var(--text-muted)' }} onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {!hasUsages ? (
          <>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('refDelete.notUsed')}
            </p>
            <div className="flex justify-end gap-2 mt-2">
              <button className={buttonSecondaryClass} onClick={onCancel}>{t('common.cancel')}</button>
              <button className={buttonDangerClass} onClick={() => onConfirm({})}>
                <Trash2 size={14} />{t('common.delete')}
              </button>
            </div>
          </>
        ) : mode === 'choose' ? (
          <>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('refDelete.usedByFlows', { count: usages.length, flows: usages.length === 1 ? 'flow' : 'flows' })}
            </p>
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
              {usages.map(u => (
                <div key={u.key} className={`${listItemCardClass} text-xs px-2 py-1`} style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{u.objectName}</span> on {u.edgeLabel}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 mt-2">
              <button
                className={buttonSecondaryClass}
                disabled={otherItems.length === 0}
                title={otherItems.length === 0 ? 'No other entry to replace it with' : undefined}
                onClick={() => setMode('replaceAll')}
              >
                {t('refDelete.replaceEverywhere')}
              </button>
              <button className={buttonSecondaryClass} onClick={() => setMode('individual')}>
                {t('refDelete.resolveIndividually')}
              </button>
              <button className={buttonSecondaryClass} onClick={onCancel}>{t('common.cancel')}</button>
            </div>
          </>
        ) : mode === 'replaceAll' ? (
          <>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('refDelete.replaceOnAllFlows', { name: item.name, count: usages.length, plural: usages.length === 1 ? '' : 's' })}
            </p>
            <select className={inputClass} value={replaceAllId} onChange={(e) => setReplaceAllId(e.target.value)}>
              {otherItems.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <div className="flex justify-end gap-2 mt-2">
              <button className={buttonSecondaryClass} onClick={() => setMode('choose')}>{t('common.back')}</button>
              <button
                className={buttonDangerClass}
                disabled={!replaceAllId}
                onClick={() => onConfirm(Object.fromEntries(usages.map(u => [u.key, replaceAllId])))}
              >
                <Trash2 size={14} />{t('refDelete.replaceAndDelete')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('refDelete.chooseReplacementEach', { name: item.name })}
            </p>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {usages.map(u => (
                <div key={u.key} className={`${listItemCardClass} flex flex-col gap-1 px-2 py-1.5`}>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{u.objectName}</span> on {u.edgeLabel}
                  </span>
                  <select
                    className={`${inputClass} px-1.5 py-1 text-xs`}
                    value={perUsageChoice[u.key] || ''}
                    onChange={(e) => setPerUsageChoice(prev => ({ ...prev, [u.key]: e.target.value }))}
                  >
                    <option value="">{t('refDelete.removeTag')}</option>
                    {otherItems.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button className={buttonSecondaryClass} onClick={() => setMode('choose')}>{t('common.back')}</button>
              <button
                className={buttonDangerClass}
                onClick={() => onConfirm(Object.fromEntries(usages.map(u => [u.key, perUsageChoice[u.key] || null])))}
              >
                <Trash2 size={14} />{t('refDelete.applyAndDelete')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReferenceListsPanel({
  integrationTypes, integrationSoftwareList, onAdd, onRename, onUpdateSoftwareTimeZone, canWrite,
  findReferenceItemUsage, onResolveAndDelete,
}: {
  integrationTypes: ReferenceListItem[];
  integrationSoftwareList: ReferenceListItem[];
  onAdd: (list: ReferenceListId, name: string) => void;
  onRename: (list: ReferenceListId, id: string, name: string) => void;
  onUpdateSoftwareTimeZone: (id: string, timeZone: string) => void;
  canWrite: boolean;
  findReferenceItemUsage: (list: ReferenceListId, itemId: string) => ReferenceItemUsage[];
  onResolveAndDelete: (list: ReferenceListId, itemId: string, usages: ReferenceItemUsage[], resolutions: Record<string, string | null>) => void;
}) {
  const { t } = useI18n();
  const listItems: Record<ReferenceListId, ReferenceListItem[]> = {
    'integration-types': integrationTypes,
    'integration-software': integrationSoftwareList,
  };
  const [deleteRequest, setDeleteRequest] = useState<{ list: ReferenceListId; item: ReferenceListItem } | null>(null);

  const requestDelete = (list: ReferenceListId, id: string) => {
    const item = listItems[list].find(i => i.id === id);
    if (item) setDeleteRequest({ list, item });
  };

  return (
    <div className="flex gap-4 flex-wrap items-start">
      <ReferenceListCard
        title={t('inventory.integrationTypes.title')}
        blurb={t('inventory.integrationTypes.blurb')}
        items={integrationTypes}
        list="integration-types"
        onAdd={onAdd}
        onRename={onRename}
        onDelete={requestDelete}
        canWrite={canWrite}
      />
      <ReferenceListCard
        title={t('inventory.integrationSoftware.title')}
        blurb={t('inventory.integrationSoftware.blurb')}
        items={integrationSoftwareList}
        list="integration-software"
        onAdd={onAdd}
        onRename={onRename}
        onDelete={requestDelete}
        onUpdateTimeZone={onUpdateSoftwareTimeZone}
        canWrite={canWrite}
      />
      {deleteRequest && (
        <ReferenceItemDeleteDialog
          item={deleteRequest.item}
          otherItems={listItems[deleteRequest.list].filter(i => i.id !== deleteRequest.item.id)}
          usages={findReferenceItemUsage(deleteRequest.list, deleteRequest.item.id)}
          onCancel={() => setDeleteRequest(null)}
          onConfirm={(resolutions) => {
            onResolveAndDelete(deleteRequest.list, deleteRequest.item.id, findReferenceItemUsage(deleteRequest.list, deleteRequest.item.id), resolutions);
            setDeleteRequest(null);
          }}
        />
      )}
    </div>
  );
}

function InventoryView({
  onSelectSystem, onViewObject, dataObjects, getSystemLabel, nodes, edges,
  renameSystem, updateSystemField, setSystemObjectName, deleteObject, deleteSystem,
  renameObjectGlobal, updateObjectField, canWrite,
  integrationTypes, integrationSoftwareList, onAddReferenceItem, onRenameReferenceItem, onUpdateSoftwareTimeZone,
  findReferenceItemUsage, onResolveAndDeleteReferenceItem,
  subView, setSubView, editingSystemId, setEditingSystemId, editingObjectId, setEditingObjectId,
  currentUserId, teamRoster,
}: {
  onSelectSystem: (id: string) => void;
  onViewObject: (id: string) => void;
  dataObjects: DataObject[];
  getSystemLabel: (id: string | null | undefined) => string | undefined;
  nodes: SystemNode[];
  edges: IntegrationEdge[];
  renameSystem: (sysId: string, newLabel: string) => void;
  updateSystemField: <K extends keyof SystemNodeData>(sysId: string, field: K, value: SystemNodeData[K], debounceKey?: string) => void;
  setSystemObjectName: (objId: string, sysId: string, entry: SystemObjectName) => void;
  deleteObject: (objId: string) => void;
  deleteSystem: (sysId: string) => void;
  renameObjectGlobal: (objId: string, newName: string) => void;
  updateObjectField: <K extends keyof DataObject>(objId: string, field: K, value: DataObject[K], debounceKey?: string) => void;
  canWrite: boolean;
  integrationTypes: ReferenceListItem[];
  integrationSoftwareList: ReferenceListItem[];
  onAddReferenceItem: (list: ReferenceListId, name: string) => void;
  onRenameReferenceItem: (list: ReferenceListId, id: string, name: string) => void;
  onUpdateSoftwareTimeZone: (id: string, timeZone: string) => void;
  findReferenceItemUsage: (list: ReferenceListId, itemId: string) => ReferenceItemUsage[];
  onResolveAndDeleteReferenceItem: (list: ReferenceListId, itemId: string, usages: ReferenceItemUsage[], resolutions: Record<string, string | null>) => void;
  // Lifted up to AppContent (rather than local state here) so the URL can reflect and restore
  // exactly which Inventory tab and row are open, the same way canvas selection does.
  subView: InventoryTab;
  setSubView: (tab: InventoryTab) => void;
  editingSystemId: string | null;
  setEditingSystemId: (id: string | null) => void;
  editingObjectId: string | null;
  setEditingObjectId: (id: string | null) => void;
  currentUserId: string | undefined;
  teamRoster: TeamRosterUser[];
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [criticalityFilter, setCriticalityFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [objectSearch, setObjectSearch] = useState('');
  const pageSize = 25;

  const editSystem = (id: string) => { setEditingSystemId(id); setEditingObjectId(null); };
  const editObject = (id: string) => { setEditingObjectId(id); setEditingSystemId(null); };

  const editingSystemNode = nodes.find(n => n.id === editingSystemId);
  const editingSystemData = isEaSystemNode(editingSystemNode) ? editingSystemNode.data : undefined;
  const objectsInEditingSystem = useMemo(
    () => objectsForSystem(editingSystemId, dataObjects, edges),
    [editingSystemId, dataObjects, edges]
  );
  const editingObject = editingObjectId ? dataObjects.find(o => o.id === editingObjectId) : undefined;

  const filteredObjects = useMemo(() => {
    if (!objectSearch) return dataObjects;
    const search = objectSearch.toLowerCase();
    return dataObjects.filter(obj => {
      if (obj.name.toLowerCase().includes(search)) return true;
      return Object.values(obj.systemObjectNames || {}).some(entry =>
        entry.name.toLowerCase().includes(search) || (entry.objectId || '').toLowerCase().includes(search)
      );
    });
  }, [dataObjects, objectSearch]);

  // Three system-to-system relationship views for the Systems inventory table, all derived from
  // the edges (which carry the data objects actually flowing between systems):
  // - connected: any system with a direct edge to/from this one, regardless of which objects flow.
  // - usesObjectsFrom: for a master system, every other system that appears on either end of an
  //   edge carrying one of that master's objects - i.e. who consumes data this system originates,
  //   including further hops where the object keeps propagating between two other systems.
  // - dataFromMasters: for a system, the master systems behind every object flowing in/out of it -
  //   the mirror image of usesObjectsFrom, read from the other side.
  const systemRelations = useMemo(() => {
    const objectsById = new Map(dataObjects.map(o => [o.id, o]));
    const connected = new Map<string, Set<string>>();
    const usesObjectsFrom = new Map<string, Set<string>>();
    const dataFromMasters = new Map<string, Set<string>>();
    const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
      if (!key || !value || value === key) return;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(value);
    };

    edges.forEach(e => {
      addTo(connected, e.source, e.target);
      addTo(connected, e.target, e.source);

      (e.data?.dataObjectIds || []).forEach(objId => {
        const masterId = objectsById.get(objId)?.masterSystemId;
        if (!masterId) return;
        addTo(usesObjectsFrom, masterId, e.source);
        addTo(usesObjectsFrom, masterId, e.target);
        addTo(dataFromMasters, e.source, masterId);
        addTo(dataFromMasters, e.target, masterId);
      });
    });

    return { connected, usesObjectsFrom, dataFromMasters };
  }, [edges, dataObjects]);

  const formatSystemSet = useCallback((set: Set<string> | undefined) =>
    set ? Array.from(set).map(id => getSystemLabel(id) || id).sort().join(', ') : '',
  [getSystemLabel]);

  const ownerNames = useCallback((ids: string[] | undefined) =>
    (ids || []).map(id => teamRoster.find(u => u.id === id)?.name || id).join(', '),
  [teamRoster]);

  // Reset to page 0 whenever a filter changes. Done during render (React's recommended pattern
  // for resetting derived state - see "Adjusting state when a prop changes") rather than in an
  // effect, which would cause an extra render pass.
  const filterKey = `${search}|${statusFilter}|${criticalityFilter}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(0);
  }

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (criticalityFilter) params.set('criticality', criticalityFilter);

      apiFetch(`/systems?${params.toString()}`)
        .then(res => res.json())
        .then(data => {
          setRows(data.systems || []);
          setTotal(data.total || 0);
        })
        .catch(err => console.error('Failed to load system inventory', err))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, statusFilter, criticalityFilter, page]);

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto p-6" style={{ background: 'var(--bg-canvas)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-bold tracking-[var(--heading-tracking)]" style={{ color: 'var(--text-primary)' }}>
              {subView === 'systems' ? t('inventory.systemInventory') : subView === 'objects' ? t('inventory.dataObjectInventory') : t('inventory.integrationReferenceLists')}
            </h2>
            <div className="inline-flex gap-1 p-1" style={{ background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-card)' }}>
              <button
                className="px-3 py-1 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
                style={subView === 'systems' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
                onClick={() => setSubView('systems')}
              >
                {t('inventory.tab.systems')}
              </button>
              <button
                className="px-3 py-1 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
                style={subView === 'objects' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
                onClick={() => setSubView('objects')}
              >
                {t('inventory.tab.dataObjects')}
              </button>
              <button
                className="px-3 py-1 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
                style={subView === 'lists' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
                onClick={() => setSubView('lists')}
              >
                {t('inventory.tab.integrationLists')}
              </button>
            </div>
          </div>

          {subView === 'lists' ? (
            <ReferenceListsPanel
              integrationTypes={integrationTypes}
              integrationSoftwareList={integrationSoftwareList}
              onAdd={onAddReferenceItem}
              onRename={onRenameReferenceItem}
              onUpdateSoftwareTimeZone={onUpdateSoftwareTimeZone}
              canWrite={canWrite}
              findReferenceItemUsage={findReferenceItemUsage}
              onResolveAndDelete={onResolveAndDeleteReferenceItem}
            />
          ) : subView === 'objects' ? (
            <>
              <div className="relative mb-4">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input
                  className={`${inputClass} pl-9 w-64`}
                  placeholder={t('inventory.searchObjects')}
                  value={objectSearch}
                  onChange={e => setObjectSearch(e.target.value)}
                />
              </div>

              <div className={`${cardClass} overflow-x-auto`}>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
                    <tr>
                      <th className="px-4 py-2.5">{t('inventory.col.dataObject')}</th>
                      <th className="px-4 py-2.5">{t('inventory.col.masterSystem')}</th>
                      <th className="px-4 py-2.5">{t('inventory.col.presentInSystems')}</th>
                      <th className="px-4 py-2.5">{t('inventory.col.classification')}</th>
                      <th className="px-4 py-2.5">{t('inventory.col.description')}</th>
                      <th className="px-4 py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredObjects.slice(0, 200).map(obj => {
                      const presentInSystems = Object.entries(obj.systemObjectNames || {})
                        .filter(([sysId]) => sysId !== obj.masterSystemId)
                        .map(([sysId, entry]) => `${getSystemLabel(sysId) || 'Unknown System'} (${entry.name})`)
                        .join(', ');
                      return (
                      <tr
                        key={obj.id}
                        className="border-t cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border-subtle)', background: editingObjectId === obj.id ? 'var(--bg-surface-alt)' : 'transparent' }}
                        onMouseEnter={e => { if (editingObjectId !== obj.id) e.currentTarget.style.background = 'var(--bg-surface-alt)'; }}
                        onMouseLeave={e => { if (editingObjectId !== obj.id) e.currentTarget.style.background = 'transparent'; }}
                        onClick={() => editObject(obj.id)}
                      >
                        <td className="px-4 py-2 font-bold" style={{ color: 'var(--text-primary)' }}>{obj.name}</td>
                        <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{getSystemLabel(obj.masterSystemId) || '—'}</td>
                        <td className="px-4 py-2 truncate max-w-xs" style={{ color: 'var(--text-secondary)' }} title={presentInSystems}>{presentInSystems || '—'}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${CLASSIFICATION_BADGE_STYLES[obj.classification || 'internal']}`}>
                            {CLASSIFICATION_LABELS[obj.classification || 'internal']}
                          </span>
                        </td>
                        <td className="px-4 py-2 truncate max-w-xs" style={{ color: 'var(--text-secondary)' }}>{obj.description || '—'}</td>
                        <td className="px-4 py-2">
                          <button
                            className="p-1.5 rounded-full transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            title="Show this object's flows on the canvas"
                            onClick={(e) => { e.stopPropagation(); onViewObject(obj.id); }}
                          >
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                    {filteredObjects.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('inventory.noObjectsMatch')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('inventory.showing', { shown: Math.min(filteredObjects.length, 200), total: filteredObjects.length })}
              </div>
            </>
          ) : (
          <>
          <div className="flex gap-2 mb-4 flex-wrap">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <input
                className={`${inputClass} pl-9 w-64`}
                placeholder={t('inventory.searchSystems')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select className={`${inputClass} w-auto`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">{t('inventory.allStatuses')}</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className={`${inputClass} w-auto`} value={criticalityFilter} onChange={e => setCriticalityFilter(e.target.value)}>
              <option value="">{t('inventory.allCriticalities')}</option>
              {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className={`${cardClass} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
                <tr>
                  <th className="px-4 py-2.5">{t('inventory.col.system')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.owner')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.status')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.criticality')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.businessCapability')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.timeZone')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.connectedSystems')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.systemsUsingItsObjects')}</th>
                  <th className="px-4 py-2.5">{t('inventory.col.dataFromMasterSystems')}</th>
                  <th className="px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.id}
                    className="border-t cursor-pointer transition-colors"
                    style={{ borderColor: 'var(--border-subtle)', background: editingSystemId === r.id ? 'var(--bg-surface-alt)' : 'transparent' }}
                    onMouseEnter={e => { if (editingSystemId !== r.id) e.currentTarget.style.background = 'var(--bg-surface-alt)'; }}
                    onMouseLeave={e => { if (editingSystemId !== r.id) e.currentTarget.style.background = 'transparent'; }}
                    onClick={() => editSystem(r.id)}
                  >
                    <td className="px-4 py-2 font-bold" style={{ color: 'var(--text-primary)' }}>{r.label}</td>
                    <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[140px]" title={ownerNames(r.owner_ids)}>{ownerNames(r.owner_ids) || '—'}</span>
                        {(r.owner_ids || []).length === 1 && (
                          <AlertTriangle size={12} style={{ color: 'var(--warning)' }} aria-label={t('owners.singleOwnerWarning')} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE_STYLES[r.status] || 'bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]'}`}>
                        {STATUS_LABELS[r.status as SystemStatus] || r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${CRITICALITY_BADGE_STYLES[r.criticality] || 'bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]'}`}>
                        {CRITICALITY_LABELS[r.criticality as Criticality] || r.criticality}
                      </span>
                    </td>
                    <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{r.business_capability || '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.time_zone || 'UTC'}</td>
                    <td className="px-4 py-2 truncate max-w-xs" style={{ color: 'var(--text-secondary)' }} title={formatSystemSet(systemRelations.connected.get(r.id))}>
                      {formatSystemSet(systemRelations.connected.get(r.id)) || '—'}
                    </td>
                    <td className="px-4 py-2 truncate max-w-xs" style={{ color: 'var(--text-secondary)' }} title={formatSystemSet(systemRelations.usesObjectsFrom.get(r.id))}>
                      {formatSystemSet(systemRelations.usesObjectsFrom.get(r.id)) || '—'}
                    </td>
                    <td className="px-4 py-2 truncate max-w-xs" style={{ color: 'var(--text-secondary)' }} title={formatSystemSet(systemRelations.dataFromMasters.get(r.id))}>
                      {formatSystemSet(systemRelations.dataFromMasters.get(r.id)) || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        className="p-1.5 rounded-full transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                        title="Show this system on the canvas"
                        onClick={(e) => { e.stopPropagation(); onSelectSystem(r.id); }}
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('inventory.noSystemsMatch')}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>{loading ? t('common.loading') : t('inventory.showing', { shown: `${from}-${to}`, total })}</span>
            <div className="flex gap-2">
              <button
                className={buttonSecondaryClass}
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <button
                className={buttonSecondaryClass}
                disabled={to >= total}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
          </>
          )}
        </div>
      </div>

      {/* Right-hand editor - mirrors the canvas sidebar so a system or data object can be edited
          in place without leaving the Inventory page. Only takes up space once something is
          actually selected, so the page isn't dominated by an empty pane by default. */}
      {(editingSystemId || editingObject) && (
        <div
          className="w-80 p-4 border-l overflow-y-auto flex flex-col gap-4 z-10 relative"
          style={{ background: 'var(--bg-surface-alt)', borderColor: 'var(--border)' }}
        >
          {editingSystemId ? (
            <SystemDetailsPanel
              systemId={editingSystemId}
              data={editingSystemData}
              objectsInSystem={objectsInEditingSystem}
              renameSystem={renameSystem}
              updateSystemField={updateSystemField}
              setSystemObjectName={setSystemObjectName}
              deleteObject={deleteObject}
              onDelete={() => { deleteSystem(editingSystemId); setEditingSystemId(null); }}
              readOnly={!canWrite}
              teamRoster={teamRoster}
              canManageOwners={canWrite || !!(currentUserId && (editingSystemData?.ownerIds || []).includes(currentUserId))}
            />
          ) : editingObject ? (
            <ObjectDetailsPanel
              object={editingObject}
              systemNodes={nodes}
              getSystemLabel={getSystemLabel}
              onBack={() => setEditingObjectId(null)}
              renameObjectGlobal={renameObjectGlobal}
              updateObjectField={updateObjectField}
              setSystemObjectName={setSystemObjectName}
              onDelete={() => { deleteObject(editingObject.id); setEditingObjectId(null); }}
              readOnly={!canWrite}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// A run's most severe flag decides its color everywhere it appears - impacted-by-downtime beats
// at-risk (an at-risk flow with no active downtime is a latent concern; one that's actually
// colliding with a downtime is the thing to act on right now).
const runSeverityStyle = (run: ScheduledRun): { background: string; color: string } =>
  run.impactedDowntimes.length > 0
    ? { background: 'var(--danger-container)', color: 'var(--on-danger-container)' }
    : run.atRisk
      ? { background: 'var(--warning-container)', color: 'var(--on-warning-container)' }
      : { background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' };

function UpcomingRunsList({ runs }: { runs: ScheduledRun[] }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const userTimeZone = user?.timeZone || detectBrowserTimeZone();
  const visible = runs.slice(0, 200);
  return (
    <div className={`${cardClass} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
          <tr>
            <th className="px-4 py-2.5">{t('schedulePage.col.when')}</th>
            <th className="px-4 py-2.5">{t('schedulePage.col.object')}</th>
            <th className="px-4 py-2.5">{t('schedulePage.col.flow')}</th>
            <th className="px-4 py-2.5">{t('schedulePage.col.frequency')}</th>
            <th className="px-4 py-2.5">{t('schedulePage.col.flags')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(run => {
            const severity = runSeverityStyle(run);
            return (
              <tr
                key={run.key}
                className="border-t"
                style={{ borderColor: 'var(--border-subtle)', background: run.impactedDowntimes.length > 0 ? severity.background : undefined }}
              >
                <td className="px-4 py-2 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                  <div>{formatInTimeZone(run.time, userTimeZone, locale)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {t('schedulePage.yourTime')} ({userTimeZone})
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {formatInTimeZone(run.time, run.sourceTimeZone, locale)}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {t('schedulePage.systemTime')}: {run.sourceLabel} ({run.sourceTimeZone})
                  </div>
                </td>
                <td className="px-4 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{run.objectName}</td>
                <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{run.sourceLabel} → {run.targetLabel}</td>
                <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{run.frequencyLabel}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {run.atRisk && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'var(--warning-container)', color: 'var(--on-warning-container)' }}>
                        <AlertTriangle size={10} />{t('schedulePage.atRisk')}
                      </span>
                    )}
                    {run.impactedDowntimes.map(dt => (
                      <span key={dt.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'var(--danger-container)', color: 'var(--on-danger-container)' }}>
                        <AlertTriangle size={10} />Impacted{dt.reason ? `: ${dt.reason}` : ''}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
              {t('schedulePage.noRuns')}
            </td></tr>
          )}
        </tbody>
      </table>
      {runs.length > visible.length && (
        <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Showing the first {visible.length} of {runs.length} runs in the next {SCHEDULE_WINDOW_DAYS} days.</div>
      )}
    </div>
  );
}

function ScheduleCalendar({ runs }: { runs: ScheduledRun[] }) {
  const { locale } = useI18n();
  const { user } = useAuth();
  const userTimeZone = user?.timeZone || detectBrowserTimeZone();
  const days = useMemo(() => {
    const result: { date: Date; key: string }[] = [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      result.push({ date: d, key: d.toISOString().slice(0, 10) });
    }
    return result;
  }, []);

  const runsByDay = useMemo(() => {
    const map: Record<string, ScheduledRun[]> = {};
    runs.forEach(run => {
      const key = run.time.toISOString().slice(0, 10);
      (map[key] ||= []).push(run);
    });
    return map;
  }, [runs]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {days.map(({ date, key }) => {
        const dayRuns = runsByDay[key] || [];
        const hasImpact = dayRuns.some(r => r.impactedDowntimes.length > 0);
        return (
          <div
            key={key}
            className={`${cardClass} p-2 flex flex-col gap-1 min-h-[130px]`}
            style={hasImpact ? { borderColor: 'var(--danger)', borderWidth: 2 } : undefined}
          >
            <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto max-h-40">
              {dayRuns.slice(0, 8).map(run => (
                <div
                  key={run.key}
                  className="text-[10px] px-1.5 py-1 rounded-[var(--radius-input)] truncate"
                  style={runSeverityStyle(run)}
                  title={`${run.objectName}: ${run.sourceLabel} → ${run.targetLabel} (${run.frequencyLabel}) — ${formatInTimeZone(run.time, userTimeZone, locale)} (you, ${userTimeZone}) / ${formatInTimeZone(run.time, run.sourceTimeZone, locale)} (${run.sourceLabel}, ${run.sourceTimeZone})`}
                >
                  {new Intl.DateTimeFormat(locale, { timeZone: userTimeZone, hour: '2-digit', minute: '2-digit' }).format(run.time)} {run.objectName}
                </div>
              ))}
              {dayRuns.length > 8 && (
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>+{dayRuns.length - 8} more</span>
              )}
              {dayRuns.length === 0 && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScheduleView({
  nodes, edges, dataObjects, edgeObjectDetails, systemDowntimes,
  getSystemLabel, getSystemTimeZone, canWrite, onAddDowntime, onDeleteDowntime,
}: {
  nodes: SystemNode[];
  edges: IntegrationEdge[];
  dataObjects: DataObject[];
  edgeObjectDetails: Record<string, EdgeObjectDetail>;
  systemDowntimes: SystemDowntime[];
  getSystemLabel: (id: string | null | undefined) => string | undefined;
  getSystemTimeZone: (id: string | null | undefined) => string;
  canWrite: boolean;
  onAddDowntime: (systemId: string, startsAt: string, endsAt: string, reason: string) => void;
  onDeleteDowntime: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const userTimeZone = user?.timeZone || detectBrowserTimeZone();
  const [subView, setSubView] = useState<'runs' | 'calendar'>('runs');
  const [dtSystemId, setDtSystemId] = useState('');
  const [dtStart, setDtStart] = useState('');
  const [dtEnd, setDtEnd] = useState('');
  const [dtReason, setDtReason] = useState('');

  const runs = useMemo(
    () => computeScheduledRuns(edges, dataObjects, edgeObjectDetails, systemDowntimes, getSystemLabel, getSystemTimeZone),
    [edges, dataObjects, edgeObjectDetails, systemDowntimes, getSystemLabel, getSystemTimeZone]
  );

  const systemOptions = nodes.filter(isEaSystemNode);

  const submitDowntime = () => {
    if (!dtSystemId || !dtStart || !dtEnd) return;
    onAddDowntime(dtSystemId, new Date(dtStart).toISOString(), new Date(dtEnd).toISOString(), dtReason);
    setDtStart('');
    setDtEnd('');
    setDtReason('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-canvas)' }}>
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold tracking-[var(--heading-tracking)]" style={{ color: 'var(--text-primary)' }}>{t('schedulePage.title')}</h2>
          <div className="inline-flex gap-1 p-1" style={{ background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-card)' }}>
            <button
              className="px-3 py-1 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
              style={subView === 'runs' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
              onClick={() => setSubView('runs')}
            >
              {t('schedulePage.upcomingRuns')}
            </button>
            <button
              className="px-3 py-1 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
              style={subView === 'calendar' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
              onClick={() => setSubView('calendar')}
            >
              {t('schedulePage.calendar')}
            </button>
          </div>
        </div>

        <div className={`${cardClass} p-4`}>
          <h3 className="font-bold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{t('schedulePage.plannedDowntimes')}</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{t('schedulePage.plannedDowntimesBlurb')}</p>

          <div className="flex flex-col gap-1.5 mb-3">
            {systemDowntimes.map(dt => {
              const systemTz = getSystemTimeZone(dt.systemId);
              return (
              <div key={dt.id} className={`${listItemCardClass} flex items-center justify-between gap-2 px-2 py-1.5 text-sm`}>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{getSystemLabel(dt.systemId) || dt.systemId}</span>
                  <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {formatInTimeZone(new Date(dt.startsAt), systemTz, locale)} — {formatInTimeZone(new Date(dt.endsAt), systemTz, locale)} ({systemTz}){dt.reason ? ` · ${dt.reason}` : ''}
                  </span>
                  <span className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {t('schedulePage.yourTime')}: {formatInTimeZone(new Date(dt.startsAt), userTimeZone, locale)} — {formatInTimeZone(new Date(dt.endsAt), userTimeZone, locale)} ({userTimeZone})
                  </span>
                </div>
                {canWrite && (
                  <button
                    className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-input)] shrink-0 transition-colors"
                    style={{ background: 'var(--danger-container)', color: 'var(--on-danger-container)' }}
                    onClick={() => onDeleteDowntime(dt.id)}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
              );
            })}
            {systemDowntimes.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No planned downtimes.</p>}
          </div>

          {canWrite && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className={labelClass}>{t('schedulePage.system')}</label>
                <select className={`${inputClass} w-40`} value={dtSystemId} onChange={(e) => setDtSystemId(e.target.value)}>
                  <option value="">{t('schedulePage.select')}</option>
                  {systemOptions.map(n => <option key={n.id} value={n.id}>{n.data.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t('schedulePage.starts')}</label>
                <input type="datetime-local" className={`${inputClass} w-auto`} value={dtStart} onChange={(e) => setDtStart(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>{t('schedulePage.ends')}</label>
                <input type="datetime-local" className={`${inputClass} w-auto`} value={dtEnd} onChange={(e) => setDtEnd(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className={labelClass}>{t('schedulePage.reason')}</label>
                <input type="text" className={inputClass} placeholder={t('schedulePage.reasonPlaceholder')} value={dtReason} onChange={(e) => setDtReason(e.target.value)} />
              </div>
              <button className={buttonSecondaryClass} onClick={submitDowntime}>
                <Plus size={14} />{t('schedulePage.addDowntime')}
              </button>
            </div>
          )}
        </div>

        {subView === 'runs' ? <UpcomingRunsList runs={runs} /> : <ScheduleCalendar runs={runs} />}
      </div>
    </div>
  );
}

type AppView = 'canvas' | 'inventory' | 'schedule' | 'settings';
type InventoryTab = 'systems' | 'objects' | 'lists';

type AppRoute = {
  view: AppView;
  canvasSystemId: string | null;
  canvasObjectId: string | null;
  canvasEdgePair: [string, string] | null;
  inventoryTab: InventoryTab;
  inventorySystemId: string | null;
  inventoryObjectId: string | null;
};

// Reads which page - and, where relevant, which system/object/edge is open for editing - the URL
// currently points at, so a refresh (or a link copied and sent to a teammate) lands back on the
// same view instead of always resetting to the canvas.
function parseRouteFromLocation(): AppRoute {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const validView: AppView = view === 'inventory' || view === 'schedule' || view === 'settings' ? view : 'canvas';
  const tab = params.get('tab');
  const validTab: InventoryTab = tab === 'objects' || tab === 'lists' ? tab : 'systems';
  const edgeIds = params.get('edge')?.split(',');

  return {
    view: validView,
    canvasSystemId: validView === 'canvas' ? params.get('system') : null,
    canvasObjectId: validView === 'canvas' ? params.get('object') : null,
    canvasEdgePair: validView === 'canvas' && edgeIds?.length === 2 ? [edgeIds[0], edgeIds[1]] : null,
    inventoryTab: validTab,
    inventorySystemId: validView === 'inventory' && validTab === 'systems' ? params.get('system') : null,
    inventoryObjectId: validView === 'inventory' && validTab === 'objects' ? params.get('object') : null,
  };
}

// The inverse of parseRouteFromLocation - serializes the current view/selection into the address
// bar's query string via replaceState, so normal clicking around updates the shareable URL without
// filling up the browser's back-button history with every intermediate selection.
function syncRouteToLocation(route: AppRoute) {
  const params = new URLSearchParams();
  if (route.view !== 'canvas') params.set('view', route.view);

  if (route.view === 'canvas') {
    if (route.canvasSystemId) params.set('system', route.canvasSystemId);
    else if (route.canvasObjectId) params.set('object', route.canvasObjectId);
    else if (route.canvasEdgePair) params.set('edge', route.canvasEdgePair.join(','));
  } else if (route.view === 'inventory') {
    if (route.inventoryTab !== 'systems') params.set('tab', route.inventoryTab);
    if (route.inventoryTab === 'systems' && route.inventorySystemId) params.set('system', route.inventorySystemId);
    if (route.inventoryTab === 'objects' && route.inventoryObjectId) params.set('object', route.inventoryObjectId);
  }

  const query = params.toString();
  const newSearch = query ? `?${query}` : '';
  if (newSearch !== window.location.search) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${newSearch}${window.location.hash}`);
  }
}

function AppContent() {
  const { tokens } = useTheme();
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const canWrite = canEdit(user?.role);
  // Parsed once on mount so a refresh - or a URL a teammate was sent - opens straight back into
  // the same page and selection, rather than always landing on the canvas.
  const [initialRoute] = useState(() => parseRouteFromLocation());
  const [nodes, setNodes] = useNodesState<SystemNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<IntegrationEdge>([]);
  const [dataObjects, setDataObjects] = useState<DataObject[]>([]);
  const [integrationTypes, setIntegrationTypes] = useState<ReferenceListItem[]>([]);
  const [integrationSoftwareList, setIntegrationSoftwareList] = useState<ReferenceListItem[]>([]);
  const [edgeObjectDetails, setEdgeObjectDetails] = useState<Record<string, EdgeObjectDetail>>({});
  const [systemDowntimes, setSystemDowntimes] = useState<SystemDowntime[]>([]);
  const [teamRoster, setTeamRoster] = useState<TeamRosterUser[]>([]);
  const [view, setView] = useState<AppView>(initialRoute.view);
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>(initialRoute.inventoryTab);
  const [inventoryEditingSystemId, setInventoryEditingSystemId] = useState<string | null>(initialRoute.inventorySystemId);
  const [inventoryEditingObjectId, setInventoryEditingObjectId] = useState<string | null>(initialRoute.inventoryObjectId);

  const [newSystemName, setNewSystemName] = useState('');
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectMaster, setNewObjectMaster] = useState('');

  // Load from DB on mount
  React.useEffect(() => {
    apiFetch(`/state`)
      .then(res => res.json())
      .then(data => {
        if (data.systems) {
          setNodes(data.systems.map((s: RawSystemRow) => ({
            id: s.id,
            type: 'eaSystem',
            position: { x: s.x, y: s.y },
            data: {
              label: s.label,
              layoutPositions: s.layout_positions || {},
              ownerIds: s.owner_ids || [],
              status: (s.status as SystemStatus) || 'active',
              criticality: (s.criticality as Criticality) || 'medium',
              businessCapability: s.business_capability || '',
              techStack: s.tech_stack || [],
              description: s.description || '',
              timeZone: s.time_zone || 'UTC',
            }
          })));
        }
        if (data.dataObjects) {
          setDataObjects(data.dataObjects.map((o: RawDataObjectRow) => ({
            id: o.id,
            name: o.name,
            masterSystemId: o.master_system_id,
            systemObjectNames: o.system_object_names || {},
            description: o.description || '',
            classification: (o.classification as DataObjectClassification) || 'internal',
          })));
        }
        if (data.edges) {
          setEdges(data.edges.map((e: RawEdgeRow) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            data: {
              dataObjectIds: e.data_object_ids,
              description: e.description || '',
              ownerIds: e.owner_ids || [],
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: tokens.edgeColor },
            style: { stroke: tokens.edgeColor, strokeWidth: 2 },
          })));
        }
        if (data.integrationTypes) setIntegrationTypes(data.integrationTypes);
        if (data.integrationSoftware) {
          setIntegrationSoftwareList(data.integrationSoftware.map((s: { id: string; name: string; time_zone?: string }) => ({
            id: s.id, name: s.name, timeZone: s.time_zone || 'UTC',
          })));
        }
        if (data.edgeObjectDetails) {
          const map: Record<string, EdgeObjectDetail> = {};
          data.edgeObjectDetails.forEach((d: RawEdgeObjectDetailRow) => {
            map[edgeObjectDetailKey(d.edge_id, d.data_object_id)] = {
              sourcePattern: d.source_pattern || '',
              targetPattern: d.target_pattern || '',
              schedule: d.schedule || DEFAULT_SCHEDULE,
              integrationTypeId: d.integration_type_id || '',
              integrationSoftwareId: d.integration_software_id || '',
              atRisk: d.at_risk || false,
            };
          });
          setEdgeObjectDetails(map);
        }
        if (data.systemDowntimes) {
          setSystemDowntimes(data.systemDowntimes.map((d: RawSystemDowntimeRow) => ({
            id: d.id,
            systemId: d.system_id,
            startsAt: d.starts_at,
            endsAt: d.ends_at,
            reason: d.reason || '',
          })));
        }
      })
      .catch(err => console.error('Failed to load state', err));
    // Runs once on mount; the memo below recomputes real edge colors from the current theme on
    // every render regardless, so `tokens` doesn't need to be a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNodes, setEdges]);

  // Every signed-in user needs the team roster to populate an owner picker (not just admins, since
  // a system/integration's own current owners can manage that one resource's owner list too).
  React.useEffect(() => {
    apiFetch('/team-roster')
      .then(res => res.json())
      .then(data => setTeamRoster(data.users || []))
      .catch(err => console.error('Failed to load team roster', err));
  }, []);

  // ---------------------------------------------------------------------------
  // Persistence: every mutation below is saved as its own granular REST call
  // (create/patch/delete on the specific system, data object, or edge involved)
  // rather than resyncing the whole graph on every change. That's what makes the
  // app viable at a large-company scale - a landscape of thousands of systems
  // can't afford to delete-and-reinsert every row on every keystroke.
  // ---------------------------------------------------------------------------
  const [pendingSaves, setPendingSaves] = useState(0);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apiRequest = useCallback(async (path: string, options?: RequestInit) => {
    setPendingSaves(p => p + 1);
    try {
      await apiFetch(path, options);
    } catch (err) {
      console.error(`API request failed: ${options?.method || 'GET'} ${path}`, err);
    } finally {
      setPendingSaves(p => {
        const next = p - 1;
        if (next === 0) {
          setSaveSuccess(true);
          if (saveSuccessTimer.current) clearTimeout(saveSuccessTimer.current);
          saveSuccessTimer.current = setTimeout(() => setSaveSuccess(false), 1500);
        }
        return next;
      });
    }
  }, []);

  const apiPost = useCallback((path: string, body: unknown) =>
    apiRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    [apiRequest]);
  const apiPatch = useCallback((path: string, body: unknown) =>
    apiRequest(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    [apiRequest]);
  const apiDelete = useCallback((path: string) => apiRequest(path, { method: 'DELETE' }), [apiRequest]);

  // Coalesces rapid-fire edits to the same field (typing in a text box, dragging a node) into a
  // single request per key instead of one per keystroke/frame.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduleSave = useCallback((key: string, fn: () => void, delay = 600) => {
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      delete saveTimers.current[key];
      fn();
    }, delay);
  }, []);

  // Which connection is open in the sidebar, identified by the two real systems it runs between
  // rather than by one visual edge id - a system pair can be backed by several raw edge rows
  // (each carrying its own subset of objects) that the canvas renders as a single consolidated
  // line, and a focused system's junction view renders a spoke per remote using a synthetic
  // junction-node id on one end. Keying selection by the resolved real system pair (see
  // resolveEdgePair) lets both of those visual forms open the same, complete connection panel.
  const [selectedEdgePair, setSelectedEdgePair] = useState<[string, string] | null>(initialRoute.canvasEdgePair);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialRoute.canvasSystemId);
  const [selectedObjectIdSidebar, setSelectedObjectIdSidebar] = useState<string | null>(initialRoute.canvasObjectId);

  // Keeps the address bar's query string in sync with whatever page/selection is currently open,
  // so refreshing - or copying the URL and sending it to a teammate with access - reopens it here.
  React.useEffect(() => {
    syncRouteToLocation({
      view,
      canvasSystemId: selectedNodeId,
      canvasObjectId: selectedObjectIdSidebar,
      canvasEdgePair: selectedEdgePair,
      inventoryTab,
      inventorySystemId: inventoryEditingSystemId,
      inventoryObjectId: inventoryEditingObjectId,
    });
  }, [view, selectedNodeId, selectedObjectIdSidebar, selectedEdgePair, inventoryTab, inventoryEditingSystemId, inventoryEditingObjectId]);
  const [pendingEdge, setPendingEdge] = useState<Connection | null>(null);
  const [pendingEdgeObject, setPendingEdgeObject] = useState<string>('');

  // A junction node's id (see JunctionNode/'junc-' ids below) isn't a real system - it's a visual
  // hub standing in for whichever system is currently focused (selectedNodeId). Substituting it
  // back lets a click on any rendered edge - plain, consolidated, or a junction spoke - resolve to
  // the two genuine systems it connects. The junction's own aggregate "main" edge (hub <-> focused
  // system) resolves to the focused system on both ends and is rejected as ambiguous.
  const resolveEdgePair = useCallback((edge: { source: string; target: string }): [string, string] | null => {
    const resolveEnd = (id: string) => id.startsWith('junc-') ? selectedNodeId : id;
    const a = resolveEnd(edge.source);
    const b = resolveEnd(edge.target);
    if (!a || !b || a === b) return null;
    return [a, b].sort() as [string, string];
  }, [selectedNodeId]);

  const selectedEdgeGroup = useMemo(() => {
    if (!selectedEdgePair) return [];
    const [a, b] = selectedEdgePair;
    return edges.filter(e => (e.source === a && e.target === b) || (e.source === b && e.target === a));
  }, [edges, selectedEdgePair]);

  // Which raw edge currently carries a given object, among all the raw edges backing the selected
  // system pair - needed because per-object detail (pattern/frequency/type/software) is stored
  // against a specific edge id, not the pair as a whole.
  const objectEdgeMap = useMemo(() => {
    const map: Record<string, string> = {};
    selectedEdgeGroup.forEach(e => {
      e.data?.dataObjectIds?.forEach(id => { if (!(id in map)) map[id] = e.id; });
    });
    return map;
  }, [selectedEdgeGroup]);

  const [filterSystemId, setFilterSystemId] = useState<string>('');
  const [filterObjectId, setFilterObjectId] = useState<string>('');

  // UI state for massive lists
  const [connectionObjectSearch, setConnectionObjectSearch] = useState('');

  const addSystem = useCallback(() => {
    if (!newSystemName) return false;
    if (nodes.some(n => isEaSystemNode(n) && n.data.label.toLowerCase() === newSystemName.trim().toLowerCase())) {
      alert('A system with this name already exists.');
      return false;
    }
    const position = { x: Math.random() * 400, y: Math.random() * 400 };
    const newNode: SystemNode = {
      id: `sys-${Date.now()}`,
      type: 'eaSystem',
      data: {
        label: newSystemName.trim(),
        layoutPositions: { 'global': position },
        ownerIds: user ? [user.id] : [],
        status: 'active',
        criticality: 'medium',
        businessCapability: '',
        techStack: [],
        description: '',
        timeZone: user?.timeZone || detectBrowserTimeZone(),
      },
      position,
    };
    setNodes((nds) => [...nds, newNode]);
    setNewSystemName('');
    apiPost('/systems', {
      id: newNode.id, label: newNode.data.label, x: position.x, y: position.y,
      layoutPositions: newNode.data.layoutPositions, timeZone: newNode.data.timeZone,
      ownerIds: newNode.data.ownerIds,
    });
    return true;
  }, [newSystemName, nodes, setNodes, apiPost, user]);

  const addObject = useCallback(() => {
    if (!newObjectName || !newObjectMaster) {
      alert('Please provide both an object name and a master system.');
      return false;
    }
    if (dataObjects.some(o => o.name.toLowerCase() === newObjectName.trim().toLowerCase())) {
      alert('A data object with this name already exists.');
      return false;
    }

    const masterName = newObjectMaster.trim();
    let masterNode = nodes.find(n => isEaSystemNode(n) && n.data.label.toLowerCase() === masterName.toLowerCase());

    // Create master system if it doesn't exist
    if (!masterNode) {
      const position = { x: Math.random() * 400, y: Math.random() * 400 };
      const ownerIds = user ? [user.id] : [];
      masterNode = {
        id: `sys-${Date.now()}`,
        type: 'eaSystem',
        data: {
          label: masterName,
          layoutPositions: { global: position },
          ownerIds, status: 'active', criticality: 'medium', businessCapability: '', techStack: [], description: '',
        },
        position,
      };
      setNodes((nds) => [...nds, masterNode!]);
      apiPost('/systems', { id: masterNode!.id, label: masterName, x: position.x, y: position.y, layoutPositions: { global: position }, ownerIds });
    }

    const newObject: DataObject = {
      id: `obj-${Date.now()}`,
      name: newObjectName.trim(),
      masterSystemId: masterNode!.id,
      systemObjectNames: {},
      description: '',
      classification: 'internal',
    };
    setDataObjects((objs) => [...objs, newObject]);
    apiPost('/data-objects', { id: newObject.id, name: newObject.name, masterSystemId: newObject.masterSystemId });
    setNewObjectName('');
    setNewObjectMaster('');
    return true;
  }, [newObjectName, newObjectMaster, dataObjects, nodes, setNodes, apiPost, user]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setPendingEdge(connection);
    },
    []
  );

  const getClosestHandles = useCallback((sNode: Node, tNode: Node) => {
    const sX = sNode.position.x + ((sNode.measured?.width || 150) / 2);
    const sY = sNode.position.y + ((sNode.measured?.height || 60) / 2);
    const tX = tNode.position.x + ((tNode.measured?.width || 150) / 2);
    const tY = tNode.position.y + ((tNode.measured?.height || 60) / 2);

    const dx = tX - sX;
    const dy = tY - sY;

    let sPos: Position;
    let tPos: Position;

    if (Math.abs(dx) > Math.abs(dy)) {
      sPos = dx > 0 ? Position.Right : Position.Left;
      tPos = dx > 0 ? Position.Left : Position.Right;
    } else {
      sPos = dy > 0 ? Position.Bottom : Position.Top;
      tPos = dy > 0 ? Position.Top : Position.Bottom;
    }

    return {
      sourceHandle: `s-${sPos}-50`,
      targetHandle: `t-${tPos}-50`
    };
  }, []);

  const confirmPendingEdge = useCallback(() => {
    if (!pendingEdge) return;

    let objectId = '';

    // Find or create object
    if (pendingEdgeObject.trim()) {
      const objName = pendingEdgeObject.trim();
      const existingObj = dataObjects.find(o => o.name.toLowerCase() === objName.toLowerCase());
      if (existingObj) {
        objectId = existingObj.id;
      } else {
        objectId = `obj-${Date.now()}`;
        // Set the source of the edge as the master system for the new object
        const newObject: DataObject = { id: objectId, name: objName, masterSystemId: pendingEdge.source, systemObjectNames: {}, description: '', classification: 'internal' };
        setDataObjects(objs => [...objs, newObject]);
        apiPost('/data-objects', { id: newObject.id, name: newObject.name, masterSystemId: newObject.masterSystemId });
      }
    }

    let finalSourceHandle = pendingEdge.sourceHandle;
    let finalTargetHandle = pendingEdge.targetHandle;

    const sNode = nodes.find(n => n.id === pendingEdge.source);
    const tNode = nodes.find(n => n.id === pendingEdge.target);

    if (sNode && tNode) {
      const best = getClosestHandles(sNode, tNode);
      finalSourceHandle = best.sourceHandle;
      finalTargetHandle = best.targetHandle;
    }

    const ownerIds = user ? [user.id] : [];
    const newEdge: IntegrationEdge = {
      ...pendingEdge,
      sourceHandle: finalSourceHandle,
      targetHandle: finalTargetHandle,
      id: `edge-${Date.now()}`,
      data: { dataObjectIds: objectId ? [objectId] : [], description: '', ownerIds },
      markerEnd: { type: MarkerType.ArrowClosed, color: tokens.edgeColor },
      style: { stroke: tokens.edgeColor, strokeWidth: 2 },
    };

    setEdges((eds) => addEdge(newEdge, eds));
    apiPost('/edges', {
      id: newEdge.id, source: newEdge.source, target: newEdge.target,
      dataObjectIds: newEdge.data!.dataObjectIds, ownerIds,
    });
    if (objectId) {
      // Frequency is mandatory per flow, so this new (edge, object) pairing gets a default the
      // moment it exists rather than being left unconfigured until someone opens the panel.
      setEdgeObjectDetails(prev => ({ ...prev, [edgeObjectDetailKey(newEdge.id, objectId)]: { schedule: DEFAULT_SCHEDULE } }));
      apiPatch(`/edges/${newEdge.id}/objects/${objectId}`, { schedule: DEFAULT_SCHEDULE });
    }
    setPendingEdge(null);
    setPendingEdgeObject('');

    // Optionally open the right sidebar for this edge
    setSelectedEdgePair([newEdge.source, newEdge.target].sort() as [string, string]);
    setSelectedNodeId(null);
  }, [pendingEdge, pendingEdgeObject, dataObjects, nodes, getClosestHandles, setDataObjects, setEdges, setEdgeObjectDetails, apiPost, apiPatch, tokens.edgeColor, user]);

  const toggleObjectOnEdge = useCallback((edgeId: string, objectId: string) => {
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id === edgeId) {
          const currentIds = e.data?.dataObjectIds || [];
          const isRemoving = currentIds.includes(objectId);
          const newIds = isRemoving
            ? currentIds.filter((id) => id !== objectId)
            : [...currentIds, objectId];
          apiPatch(`/edges/${edgeId}`, { dataObjectIds: newIds });
          if (isRemoving) {
            // The object's per-flow details (pattern/frequency/type/software) belong to this
            // specific (edge, object) pairing, so they're meaningless once the object is no
            // longer carried by this edge - drop them rather than leave them stranded.
            apiDelete(`/edges/${edgeId}/objects/${objectId}`);
            setEdgeObjectDetails(prev => {
              const key = edgeObjectDetailKey(edgeId, objectId);
              if (!(key in prev)) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
          } else {
            // Frequency is mandatory per flow, so this new pairing gets a default schedule the
            // moment it exists rather than being left unconfigured until someone opens the panel.
            const key = edgeObjectDetailKey(edgeId, objectId);
            setEdgeObjectDetails(prev => ({ ...prev, [key]: { ...prev[key], schedule: prev[key]?.schedule || DEFAULT_SCHEDULE } }));
            apiPatch(`/edges/${edgeId}/objects/${objectId}`, { schedule: DEFAULT_SCHEDULE });
          }
          return { ...e, data: { ...e.data, dataObjectIds: newIds } };
        }
        return e;
      })
    );
  }, [setEdges, setEdgeObjectDetails, apiPatch, apiDelete]);

  const getEdgeObjectDetail = useCallback((edgeId: string, objectId: string): EdgeObjectDetail => {
    return edgeObjectDetails[edgeObjectDetailKey(edgeId, objectId)] || {};
  }, [edgeObjectDetails]);

  const updateEdgeObjectDetail = useCallback(<K extends keyof EdgeObjectDetail>(
    edgeId: string, objectId: string, field: K, value: EdgeObjectDetail[K]
  ) => {
    const key = edgeObjectDetailKey(edgeId, objectId);
    setEdgeObjectDetails(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    apiPatch(`/edges/${edgeId}/objects/${objectId}`, { [field]: value });
  }, [apiPatch]);

  const deleteSelectedEdge = useCallback(() => {
    if (selectedEdgeGroup.length > 0) {
      const idsToRemove = new Set(selectedEdgeGroup.map(e => e.id));
      idsToRemove.forEach(id => apiDelete(`/edges/${id}`));
      setEdges((eds) => eds.filter(e => !idsToRemove.has(e.id)));
      setSelectedEdgePair(null);
    }
  }, [selectedEdgeGroup, setEdges, apiDelete]);

  const deleteObject = useCallback((objId: string) => {
    const obj = dataObjects.find(o => o.id === objId);
    if (!window.confirm(`Are you sure you want to permanently delete the Data Object "${obj?.name}"? All connections exclusively using this object will also be deleted.`)) {
      return;
    }

    // Remove object
    setDataObjects(objs => objs.filter(o => o.id !== objId));
    apiDelete(`/data-objects/${objId}`);

    // Remove object from edges. If an edge has no objects left, delete the edge entirely;
    // otherwise persist its trimmed-down object list.
    setEdges(eds => {
      const updated = eds.map(e => ({
        ...e,
        data: {
          ...e.data,
          dataObjectIds: e.data?.dataObjectIds?.filter(id => id !== objId) || []
        }
      }));
      updated.forEach((e, i) => {
        const original = eds[i];
        if (!original.data?.dataObjectIds?.includes(objId)) return;
        if (e.data.dataObjectIds.length === 0) {
          apiDelete(`/edges/${e.id}`);
        } else {
          apiPatch(`/edges/${e.id}`, { dataObjectIds: e.data.dataObjectIds });
        }
      });
      return updated.filter(e => e.data.dataObjectIds.length > 0);
    });
  }, [dataObjects, setDataObjects, setEdges, apiDelete, apiPatch]);

  const deleteSystem = useCallback((sysId: string) => {
    // Remove system node, its edges, and any data objects it masters - mirrors the
    // ON DELETE CASCADE the backend applies for the same relationships.
    setNodes(nds => nds.filter(n => n.id !== sysId));
    setEdges(eds => eds.filter(e => e.source !== sysId && e.target !== sysId));
    setDataObjects(objs => objs.filter(o => o.masterSystemId !== sysId));
    apiDelete(`/systems/${sysId}`);
  }, [setNodes, setEdges, setDataObjects, apiDelete]);

  const renameSystem = useCallback((sysId: string, newLabel: string) => {
    setNodes(nds => nds.map(n => {
      if (n.id === sysId && n.type === 'eaSystem') {
        return { ...n, data: { ...n.data, label: newLabel } };
      }
      return n;
    }));
    scheduleSave(`system-label-${sysId}`, () => apiPatch(`/systems/${sysId}`, { label: newLabel }));
  }, [setNodes, scheduleSave, apiPatch]);

  const renameObjectGlobal = useCallback((objId: string, newName: string) => {
    setDataObjects(objs => objs.map(o => {
      if (o.id === objId) return { ...o, name: newName };
      return o;
    }));
    scheduleSave(`object-name-${objId}`, () => apiPatch(`/data-objects/${objId}`, { name: newName }));
  }, [setDataObjects, scheduleSave, apiPatch]);

  const setSystemObjectName = useCallback((objId: string, sysId: string, entry: SystemObjectName) => {
    setDataObjects(objs => objs.map(o => {
      if (o.id === objId) {
        const systemObjectNames = { ...(o.systemObjectNames || {}), [sysId]: entry };
        scheduleSave(`object-system-names-${objId}`, () => apiPatch(`/data-objects/${objId}`, { systemObjectNames }));
        return { ...o, systemObjectNames };
      }
      return o;
    }));
  }, [setDataObjects, scheduleSave, apiPatch]);

  // Generic field editors for the richer metadata panels below - each patches only the one
  // system/object/edge that changed, optionally debounced (per-field key) for free-text inputs.
  const updateSystemField = useCallback(<K extends keyof SystemNodeData>(sysId: string, field: K, value: SystemNodeData[K], debounceKey?: string) => {
    setNodes(nds => nds.map(n => (n.id === sysId && isEaSystemNode(n)) ? { ...n, data: { ...n.data, [field]: value } } : n));
    const doPatch = () => apiPatch(`/systems/${sysId}`, { [field]: value });
    if (debounceKey) scheduleSave(debounceKey, doPatch); else doPatch();
  }, [setNodes, apiPatch, scheduleSave]);

  const updateObjectField = useCallback(<K extends keyof DataObject>(objId: string, field: K, value: DataObject[K], debounceKey?: string) => {
    setDataObjects(objs => objs.map(o => o.id === objId ? { ...o, [field]: value } : o));
    const doPatch = () => apiPatch(`/data-objects/${objId}`, { [field]: value });
    if (debounceKey) scheduleSave(debounceKey, doPatch); else doPatch();
  }, [apiPatch, scheduleSave]);

  const updateEdgeField = useCallback(<K extends keyof IntegrationEdgeData>(edgeId: string, field: K, value: IntegrationEdgeData[K], debounceKey?: string) => {
    setEdges(eds => eds.map(e => e.id === edgeId ? { ...e, data: { ...(e.data as IntegrationEdgeData), [field]: value } } : e));
    const doPatch = () => apiPatch(`/edges/${edgeId}`, { [field]: value });
    if (debounceKey) scheduleSave(debounceKey, doPatch); else doPatch();
  }, [setEdges, apiPatch, scheduleSave]);

  // Shared CRUD for the two admin-maintainable reference lists (Integration Types, Integration
  // Software) - both are simple {id, name} tables managed from the Inventory page.
  const addReferenceListItem = useCallback((
    path: ReferenceListId,
    idPrefix: string,
    setList: React.Dispatch<React.SetStateAction<ReferenceListItem[]>>,
    name: string
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `${idPrefix}-${Date.now()}`;
    setList(items => [...items, { id, name: trimmed }].sort((a, b) => a.name.localeCompare(b.name)));
    apiPost(`/${path}`, { id, name: trimmed });
  }, [apiPost]);

  const renameReferenceListItem = useCallback((
    path: ReferenceListId,
    setList: React.Dispatch<React.SetStateAction<ReferenceListItem[]>>,
    id: string,
    newName: string
  ) => {
    setList(items => items.map(item => item.id === id ? { ...item, name: newName } : item));
    scheduleSave(`refitem-${id}`, () => apiPatch(`/${path}/${id}`, { name: newName }));
  }, [apiPatch, scheduleSave]);

  const deleteReferenceListItem = useCallback((
    path: ReferenceListId,
    setList: React.Dispatch<React.SetStateAction<ReferenceListItem[]>>,
    id: string
  ) => {
    setList(items => items.filter(item => item.id !== id));
    apiDelete(`/${path}/${id}`);
  }, [apiDelete]);

  const addDowntime = useCallback((systemId: string, startsAt: string, endsAt: string, reason: string) => {
    if (!systemId || !startsAt || !endsAt) return;
    const id = `downtime-${Date.now()}`;
    const newDowntime: SystemDowntime = { id, systemId, startsAt, endsAt, reason };
    setSystemDowntimes(prev => [...prev, newDowntime].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
    apiPost('/system-downtimes', { id, systemId, startsAt, endsAt, reason });
  }, [apiPost]);

  const deleteDowntime = useCallback((id: string) => {
    setSystemDowntimes(prev => prev.filter(d => d.id !== id));
    apiDelete(`/system-downtimes/${id}`);
  }, [apiDelete]);

  // Thin adapters so InventoryView (which doesn't know about each list's individual setState
  // function or id prefix) can address either list by name alone.
  const referenceListSetters = useMemo((): Record<ReferenceListId, [React.Dispatch<React.SetStateAction<ReferenceListItem[]>>, string]> => ({
    'integration-types': [setIntegrationTypes, 'itype'],
    'integration-software': [setIntegrationSoftwareList, 'isw'],
  }), []);

  const handleAddReferenceItem = useCallback((list: ReferenceListId, name: string) => {
    const [setList, idPrefix] = referenceListSetters[list];
    addReferenceListItem(list, idPrefix, setList, name);
  }, [addReferenceListItem, referenceListSetters]);

  const handleRenameReferenceItem = useCallback((list: ReferenceListId, id: string, name: string) => {
    const [setList] = referenceListSetters[list];
    renameReferenceListItem(list, setList, id, name);
  }, [renameReferenceListItem, referenceListSetters]);

  // Integration Software is the only reference list with a field beyond {id, name} - its shared
  // time zone - so it gets its own small update path rather than the generic rename plumbing.
  const handleUpdateSoftwareTimeZone = useCallback((id: string, timeZone: string) => {
    setIntegrationSoftwareList(items => items.map(item => item.id === id ? { ...item, timeZone } : item));
    apiPatch(`/integration-software/${id}`, { timeZone });
  }, [apiPatch]);

  const handleInventorySelect = useCallback((sysId: string) => {
    setSelectedNodeId(sysId);
    setSelectedEdgePair(null);
    setSelectedObjectIdSidebar(null);
    setView('canvas');
  }, []);

  // The Inventory page's "eye" icon for a data object: objects aren't nodes on the canvas, so
  // "showing" one means decluttering the graph down to just its flows via the existing object
  // filter, rather than selecting/focusing a node the way a system's eye icon does.
  const handleViewObjectInCanvas = useCallback((objId: string) => {
    setFilterObjectId(objId);
    setFilterSystemId('');
    setSelectedNodeId(null);
    setSelectedEdgePair(null);
    setSelectedObjectIdSidebar(null);
    setView('canvas');
  }, []);

  // Compute which objects have multiple masters (Optimized for scale)
  const objectsWithMultipleMasters = useMemo(() => {
    const multiple = new Set<string>();

    // Map edges to find sources per object
    const sourcesPerObj: Record<string, Set<string>> = {};
    for (const e of edges) {
      if (!e.data?.dataObjectIds) continue;
      for (const objId of e.data.dataObjectIds) {
        if (!sourcesPerObj[objId]) sourcesPerObj[objId] = new Set();
        sourcesPerObj[objId].add(e.source);
      }
    }

    for (const obj of dataObjects) {
      const masters = sourcesPerObj[obj.id] || new Set();
      masters.add(obj.masterSystemId);
      if (masters.size > 1) {
        multiple.add(obj.id);
      }
    }

    return multiple;
  }, [edges, dataObjects]);

  // Objects that share the same name within a given system represent the same record type there
  // (e.g. Workday's "Employee Bank Details" and Coupa's "Supplier Bank Details" both landing as
  // NetSuite's "Bank Details" record) even though each keeps its own independent master - this is
  // a deliberate convergence, not the multi-master conflict tracked above. Maps `${objId}::${sysId}`
  // to the shared name so edges touching that system can be visually bundled under it.
  const recordTypeGroupsByObject = useMemo(() => {
    const bySysName = new Map<string, Map<string, Set<string>>>();
    for (const obj of dataObjects) {
      if (!obj.systemObjectNames) continue;
      for (const [sysId, entry] of Object.entries(obj.systemObjectNames)) {
        const name = entry?.name?.trim();
        if (!name) continue;
        if (!bySysName.has(sysId)) bySysName.set(sysId, new Map());
        const nameMap = bySysName.get(sysId)!;
        if (!nameMap.has(name)) nameMap.set(name, new Set());
        nameMap.get(name)!.add(obj.id);
      }
    }

    const result = new Map<string, string>();
    bySysName.forEach((nameMap, sysId) => {
      nameMap.forEach((objIds, name) => {
        if (objIds.size > 1) {
          objIds.forEach(id => result.set(`${id}::${sysId}`, name));
        }
      });
    });
    return result;
  }, [dataObjects]);

  const getRecordTypeGroup = useCallback((objIds: string[], sysIds: (string | undefined)[]) => {
    for (const objId of objIds) {
      for (const sysId of sysIds) {
        if (!sysId) continue;
        const name = recordTypeGroupsByObject.get(`${objId}::${sysId}`);
        if (name) return name;
      }
    }
    return undefined;
  }, [recordTypeGroupsByObject]);

  const getSystemObjectName = useCallback((objId: string, sysId: string) => {
    const obj = dataObjects.find(o => o.id === objId);
    if (!obj) return '';
    return obj.systemObjectNames?.[sysId]?.name || obj.name;
  }, [dataObjects]);

  const getSystemLabel = useCallback((sysId: string | null | undefined) => {
    const node = nodes.find(n => n.id === sysId);
    return isEaSystemNode(node) ? node.data.label : undefined;
  }, [nodes]);

  const getSystemTimeZone = useCallback((sysId: string | null | undefined) => {
    const node = nodes.find(n => n.id === sysId);
    return (isEaSystemNode(node) ? node.data.timeZone : undefined) || 'UTC';
  }, [nodes]);

  // Every (edge, object) flow currently tagged with a given reference-list item - what gates the
  // Integration Lists tab's delete flow from silently leaving a flow pointing at a deleted id.
  const findReferenceItemUsage = useCallback((list: ReferenceListId, itemId: string): ReferenceItemUsage[] => {
    const field = REFERENCE_LIST_FIELD[list];
    const usages: ReferenceItemUsage[] = [];
    Object.entries(edgeObjectDetails).forEach(([key, detail]) => {
      if (detail[field] !== itemId) return;
      const [edgeId, objectId] = key.split('::');
      const edge = edges.find(e => e.id === edgeId);
      const obj = dataObjects.find(o => o.id === objectId);
      usages.push({
        key, edgeId, objectId,
        edgeLabel: edge ? `${getSystemLabel(edge.source) || edge.source} → ${getSystemLabel(edge.target) || edge.target}` : edgeId,
        objectName: obj?.name || objectId,
      });
    });
    return usages;
  }, [edgeObjectDetails, edges, dataObjects, getSystemLabel]);

  // Applies each usage's resolution (a replacement item, or plain removal) before deleting the
  // reference-list item itself, so no connection is left tagged with an id that no longer exists.
  const handleResolveAndDeleteReferenceItem = useCallback((
    list: ReferenceListId,
    itemId: string,
    usages: ReferenceItemUsage[],
    resolutions: Record<string, string | null>
  ) => {
    if (usages.length > 0) {
      const field = REFERENCE_LIST_FIELD[list];
      const nextDetails = { ...edgeObjectDetails };
      usages.forEach(u => {
        const replacement = resolutions[u.key] || '';
        nextDetails[u.key] = { ...nextDetails[u.key], [field]: replacement };
        apiPatch(`/edges/${u.edgeId}/objects/${u.objectId}`, { [field]: replacement });
      });
      setEdgeObjectDetails(nextDetails);
    }

    const [setList] = referenceListSetters[list];
    deleteReferenceListItem(list, setList, itemId);
  }, [edgeObjectDetails, apiPatch, referenceListSetters, deleteReferenceListItem]);

  const { processedNodes, processedEdges } = useMemo(() => {
    let finalNodes: Node[] = [...nodes.filter(n => n.type !== 'junction')]; // Base system nodes
    let finalEdges: Edge[] = [];
    const hiddenOriginalEdges = new Set<string>();

    // 1. Apply Junction Pattern if a node is selected
    if (selectedNodeId) {
      const selectedNode = finalNodes.find(n => n.id === selectedNodeId);
      if (selectedNode) {
        // For a given direction, every remote system must contribute exactly one line into/out of
        // the selected node - otherwise a remote with several differently-named flows ends up
        // drawn as both a direct edge AND a junction spoke occupying the same path. So we first
        // bucket edges by remote system (one line per remote), then group remotes that share an
        // identical combined local label - only those groups are genuine fan-in/fan-out and need
        // a junction; a lone remote is always drawn as a single edge.
        const addJunctions = (isIncoming: boolean) => {
          const relevantEdges = edges.filter(e => isIncoming ? e.target === selectedNodeId : e.source === selectedNodeId);

          const byRemote = new Map<string, IntegrationEdge[]>();
          relevantEdges.forEach(e => {
            const remoteId = isIncoming ? e.source : e.target;
            if (!byRemote.has(remoteId)) byRemote.set(remoteId, []);
            byRemote.get(remoteId)!.push(e);
          });

          const remoteLocalLabel = new Map<string, string>();
          byRemote.forEach((es, remoteId) => {
            const objIds = new Set<string>();
            es.forEach(e => e.data?.dataObjectIds?.forEach(id => objIds.add(id)));
            remoteLocalLabel.set(remoteId, Array.from(objIds).map(id => getSystemObjectName(id, selectedNodeId)).join(', ') || 'Unknown');
          });

          const labelGroups = new Map<string, string[]>();
          remoteLocalLabel.forEach((label, remoteId) => {
            if (!labelGroups.has(label)) labelGroups.set(label, []);
            labelGroups.get(label)!.push(remoteId);
          });

          Array.from(labelGroups.entries()).forEach(([localLabel, remoteIds], index) => {
            const groupEdges = remoteIds.flatMap(rid => byRemote.get(rid)!);

            // A junction only earns its keep when it declutters a genuine fan-in/fan-out of
            // multiple remote systems. A single remote is always a plain 1:1 link - even if its
            // name there differs from the selected node's naming - and is drawn as a normal
            // (possibly consolidated) edge in the standard-edges pass below.
            if (remoteIds.length === 1) {
              return;
            }

            const juncId = `junc-${isIncoming ? 'in' : 'out'}-${localLabel.replace(/\s/g, '-')}-${index}`;

            groupEdges.forEach(e => hiddenOriginalEdges.add(e.id));

            // Calculate midpoint for junction (one point per remote system, not per raw edge)
            let sumX = 0, sumY = 0, count = 0;
            if (selectedNode) {
              sumX += selectedNode.position.x + ((selectedNode.measured?.width || 150) / 2);
              sumY += selectedNode.position.y + ((selectedNode.measured?.height || 60) / 2);
              count++;
            }
            remoteIds.forEach(remoteId => {
              const remoteNode = finalNodes.find(n => n.id === remoteId);
              if (remoteNode) {
                sumX += remoteNode.position.x + ((remoteNode.measured?.width || 150) / 2);
                sumY += remoteNode.position.y + ((remoteNode.measured?.height || 60) / 2);
                count++;
              }
            });
            let juncX = count > 0 ? sumX / count : 0;
            let juncY = count > 0 ? sumY / count : 0;

            // Adjust to center the 16x16 junction node and offset by index slightly
            juncX = juncX - 8 + (index * 20);
            juncY = juncY - 8 + (index * 20);

            const juncNode = {
              id: juncId,
              type: 'junction',
              position: { x: juncX, y: juncY },
              data: {},
              measured: { width: 16, height: 16 },
              width: 16,
              height: 16,
            } as Node;
            finalNodes.push(juncNode);

            // Base color logic
            const hasConflict = groupEdges.some(e => e.data?.dataObjectIds?.some(id => objectsWithMultipleMasters.has(id)));
            const color = hasConflict ? tokens.edgeConflictColor : tokens.edgeColor;
            const strokeWidth = hasConflict ? 3 : 2;
            const baseEdgeStyle = {
              type: 'smoothstep',
              style: { stroke: color, strokeWidth },
              labelStyle: { fill: color, fontWeight: 700, fontSize: 11 },
              labelBgStyle: { fill: tokens.labelBg, fillOpacity: 0.9, stroke: color, strokeWidth: 1 },
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 4,
              markerEnd: { type: MarkerType.ArrowClosed, color },
            };

            if (isIncoming) {
              const bestMain = getClosestHandles(juncNode, selectedNode);
              finalEdges.push({
                ...baseEdgeStyle,
                id: `${juncId}-main`,
                source: juncId,
                target: selectedNodeId,
                sourceHandle: bestMain.sourceHandle,
                targetHandle: bestMain.targetHandle,
                label: localLabel,
              });
              // One sub-edge per remote system (not per raw edge), so a remote with several
              // data objects flowing under this label still gets a single spoke into the junction.
              remoteIds.forEach((remoteId, i) => {
                const remoteNode = finalNodes.find(n => n.id === remoteId);
                const bestSub = remoteNode ? getClosestHandles(remoteNode, juncNode) : { sourceHandle: undefined, targetHandle: undefined };
                const remoteEdges = byRemote.get(remoteId)!;
                const remoteObjIds = new Set<string>();
                remoteEdges.forEach(e => e.data?.dataObjectIds?.forEach(id => remoteObjIds.add(id)));
                const remoteLabel = Array.from(remoteObjIds).map(id => getSystemObjectName(id, remoteId)).join(', ');
                finalEdges.push({
                  ...baseEdgeStyle,
                  id: `${juncId}-sub-${i}`,
                  source: remoteId,
                  target: juncId,
                  sourceHandle: bestSub.sourceHandle,
                  targetHandle: bestSub.targetHandle,
                  label: remoteLabel,
                  data: { dataObjectIds: Array.from(remoteObjIds) }
                });
              });
            } else {
              const bestMain = getClosestHandles(selectedNode, juncNode);
              finalEdges.push({
                ...baseEdgeStyle,
                id: `${juncId}-main`,
                source: selectedNodeId,
                target: juncId,
                sourceHandle: bestMain.sourceHandle,
                targetHandle: bestMain.targetHandle,
                label: localLabel,
              });
              remoteIds.forEach((remoteId, i) => {
                const remoteNode = finalNodes.find(n => n.id === remoteId);
                const bestSub = remoteNode ? getClosestHandles(juncNode, remoteNode) : { sourceHandle: undefined, targetHandle: undefined };
                const remoteEdges = byRemote.get(remoteId)!;
                const remoteObjIds = new Set<string>();
                remoteEdges.forEach(e => e.data?.dataObjectIds?.forEach(id => remoteObjIds.add(id)));
                const remoteLabel = Array.from(remoteObjIds).map(id => getSystemObjectName(id, remoteId)).join(', ');
                finalEdges.push({
                  ...baseEdgeStyle,
                  id: `${juncId}-sub-${i}`,
                  source: juncId,
                  target: remoteId,
                  sourceHandle: bestSub.sourceHandle,
                  targetHandle: bestSub.targetHandle,
                  label: remoteLabel,
                  data: { dataObjectIds: Array.from(remoteObjIds) }
                });
              });
            }
          });
        };

        addJunctions(true);
        addJunctions(false);
      }
    }

    // 2. Process standard edges (Consolidate multiple edges between nodes)
    const pairwiseEdges = new Map<string, IntegrationEdge[]>();

    edges.forEach(e => {
      if (hiddenOriginalEdges.has(e.id)) return;

      const sortedPair = [e.source, e.target].sort();
      const pairKey = `${sortedPair[0]}-${sortedPair[1]}`;

      if (!pairwiseEdges.has(pairKey)) pairwiseEdges.set(pairKey, []);
      pairwiseEdges.get(pairKey)!.push(e);
    });

    pairwiseEdges.forEach((group, pairKey) => {
      const e = group[0];
      const groupObjIds = group.flatMap(ge => ge.data?.dataObjectIds || []);
      const hasConflict = group.some(ge => ge.data?.dataObjectIds?.some(id => objectsWithMultipleMasters.has(id)));
      const recordType = !hasConflict ? getRecordTypeGroup(groupObjIds, [e.source, e.target]) : undefined;
      const color = hasConflict ? tokens.edgeConflictColor : tokens.edgeColor;
      const strokeWidth = hasConflict ? 3 : 2;

      const sNode = finalNodes.find(n => n.id === e.source);
      const tNode = finalNodes.find(n => n.id === e.target);
      let sHandle = e.sourceHandle;
      let tHandle = e.targetHandle;
      if (sNode && tNode) {
        const best = getClosestHandles(sNode, tNode);
        sHandle = best.sourceHandle;
        tHandle = best.targetHandle;
      }

      if (group.length === 1) {
        const labels = e.data?.dataObjectIds?.map(id => getSystemObjectName(id, e.source)).join(', ') || '';
        const displayLabel = recordType ? `${labels} → ${recordType}` : labels;
        finalEdges.push({
          ...e,
          sourceHandle: sHandle,
          targetHandle: tHandle,
          label: displayLabel,
          type: 'smoothstep',
          style: { stroke: color, strokeWidth },
          labelStyle: { fill: color, fontWeight: 700, fontSize: 11 },
          labelBgStyle: { fill: tokens.labelBg, fillOpacity: 0.9, stroke: color, strokeWidth: 1 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: { type: MarkerType.ArrowClosed, color },
        });
      } else {
        const allLabels = new Set<string>();
        let hasForward = false;
        let hasBackward = false;

        group.forEach(ge => {
          if (ge.source === e.source) hasForward = true;
          if (ge.source === e.target) hasBackward = true;
          ge.data?.dataObjectIds?.forEach(id => allLabels.add(getSystemObjectName(id, ge.source)));
        });

        const labels = Array.from(allLabels).filter(Boolean);
        const joinedLabels = labels.length > 3 ? `${labels.length} flows` : labels.join(', ');
        const displayLabel = recordType ? `${joinedLabels} → ${recordType}` : joinedLabels;

        const markerEnd = hasForward ? { type: MarkerType.ArrowClosed, color } : undefined;
        const markerStart = hasBackward ? { type: MarkerType.ArrowClosed, color, orient: 'auto-start-reverse' } : undefined;

        finalEdges.push({
          ...e,
          id: `consolidated-${pairKey}`,
          sourceHandle: sHandle,
          targetHandle: tHandle,
          label: displayLabel,
          type: 'smoothstep',
          style: { stroke: color, strokeWidth },
          labelStyle: { fill: color, fontWeight: 700, fontSize: 11 },
          labelBgStyle: { fill: tokens.labelBg, fillOpacity: 0.9, stroke: color, strokeWidth: 1 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd,
          markerStart,
        });
      }
    });

    // 3. Apply Global Filters and Selection Filtering

    // If a node is selected, we ONLY want to see end-to-end flows of objects that belong to this system.
    const allowedObjectIds = new Set<string>();
    let isFilteringBySelection = false;

    if (selectedNodeId) {
      isFilteringBySelection = true;
      dataObjects.forEach(o => {
        if (o.masterSystemId === selectedNodeId) allowedObjectIds.add(o.id);
      });
      edges.forEach(e => {
        if (e.source === selectedNodeId || e.target === selectedNodeId) {
          e.data?.dataObjectIds?.forEach(id => allowedObjectIds.add(id));
        }
      });
    }

    if (filterSystemId || filterObjectId || isFilteringBySelection) {
      finalEdges = finalEdges.filter(e => {
        if (filterSystemId && e.source !== filterSystemId && e.target !== filterSystemId && !e.id.includes('junc')) {
           return false;
        }
        const eData = e.data as IntegrationEdgeData | undefined;
        if (filterObjectId && eData?.dataObjectIds && !eData.dataObjectIds.includes(filterObjectId)) return false;

        // Hide edges that don't belong to the selected system's objects
        if (isFilteringBySelection) {
          // A junction edge is tied to the selected node's objects implicitly, but let's be careful.
          // The junction edge data is copied from the original edges.
          const edgeObjIds = eData?.dataObjectIds || [];
          if (edgeObjIds.length > 0 && !edgeObjIds.some(id => allowedObjectIds.has(id))) {
            return false;
          }
        }

        return true;
      });

      // Filter nodes to only those involved in the visible edges, plus the selected node itself
      const visibleNodeIds = new Set<string>();
      if (selectedNodeId) visibleNodeIds.add(selectedNodeId);
      if (filterSystemId) visibleNodeIds.add(filterSystemId);

      finalEdges.forEach(e => {
        visibleNodeIds.add(e.source);
        visibleNodeIds.add(e.target);
      });

      finalNodes = finalNodes.filter(n => visibleNodeIds.has(n.id));
    }

    // Apply context-specific positions and highlighting
    finalNodes = finalNodes.map(n => {
      if (!isEaSystemNode(n)) return n;

      const contextKey = selectedNodeId || 'global';
      const layoutPositions = n.data.layoutPositions || {};

      let position = n.position;
      if (contextKey !== 'global' && layoutPositions[contextKey]) {
        position = layoutPositions[contextKey];
      } else if (layoutPositions['global']) {
        position = layoutPositions['global'];
      }

      return {
        ...n,
        position,
        data: {
          ...n.data,
          isHighlighted: n.id === selectedNodeId
        }
      };
    }) as SystemNode[];

    return { processedNodes: finalNodes, processedEdges: finalEdges as IntegrationEdge[] };
  }, [nodes, edges, dataObjects, objectsWithMultipleMasters, filterSystemId, filterObjectId, selectedNodeId, getSystemObjectName, getRecordTypeGroup, getClosestHandles, tokens]);

  const primaryEdge = selectedEdgeGroup[0];
  const selectedSystemNode = nodes.find(n => n.id === selectedNodeId);
  const selectedSystemData = isEaSystemNode(selectedSystemNode) ? selectedSystemNode.data : undefined;
  const selectedObject = selectedObjectIdSidebar ? dataObjects.find(o => o.id === selectedObjectIdSidebar) : undefined;

  // Audit trail: pings a "view" event for whichever record's detail panel is now on screen -
  // covers every way of getting there (canvas click, Inventory's "show on canvas" eye icon, or
  // restoring a shared/deep-linked URL on page load), since they all funnel through these same
  // three selection states. Deliberately not tied to the underlying /api/systems, /api/edges, or
  // /api/data-objects list fetches, which fire on every canvas/Inventory load and would otherwise
  // flood the trail with "views" nobody actually looked at.
  //
  // Each effect below is keyed only on the *id* (selectedNodeId/selectedEdgePair/
  // selectedObjectIdSidebar), never on `nodes`/`dataObjects` or anything derived from them
  // (getSystemLabel, selectedObject) - those are recreated on every autosave/poll/drag even when
  // the selection itself hasn't changed, and including them here would re-log a "view" on every
  // one of those instead of only on an actual selection change. `nodesRef`/`dataObjectsRef` (kept
  // current on every render, read only inside the effects) let the label still be resolved fresh
  // without pulling either array into a dependency array.
  const nodesRef = useRef(nodes);
  const dataObjectsRef = useRef(dataObjects);
  // Refs can't be written during render (only read/written from an effect or event handler) - two
  // dependency-less effects keep them current after every render, ordered ahead of the selection-
  // ping effects below so those always read an already-fresh value within the same commit.
  useEffect(() => { nodesRef.current = nodes; });
  useEffect(() => { dataObjectsRef.current = dataObjects; });

  useEffect(() => {
    if (!selectedNodeId) return;
    const node = nodesRef.current.find(n => n.id === selectedNodeId);
    logAuditView('system', selectedNodeId, isEaSystemNode(node) ? node.data.label : selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!selectedEdgePair) return;
    const labelOf = (id: string) => {
      const node = nodesRef.current.find(n => n.id === id);
      return isEaSystemNode(node) ? node.data.label : id;
    };
    logAuditView('edge', selectedEdgePair.join(':'), `${labelOf(selectedEdgePair[0])} → ${labelOf(selectedEdgePair[1])}`);
  }, [selectedEdgePair]);

  useEffect(() => {
    if (!selectedObjectIdSidebar) return;
    const obj = dataObjectsRef.current.find(o => o.id === selectedObjectIdSidebar);
    logAuditView('data_object', selectedObjectIdSidebar, obj?.name || selectedObjectIdSidebar);
  }, [selectedObjectIdSidebar]);

  // Coarser "which page/tab is open" view logging, alongside (not instead of) the record-level
  // pings above - covers Canvas, Schedule, and each Inventory tab, which don't have a more specific
  // record to attribute a view to when nothing on them is individually selected.
  useEffect(() => {
    const pageId = view === 'inventory' ? `inventory/${inventoryTab}` : view;
    logAuditView('page', pageId, pageId);
  }, [view, inventoryTab]);

  const onContextAwareNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prevNodes) => {
      // First, handle position changes specially for context-awareness
      const positionChanges = changes.filter((c): c is NodeChange & { type: 'position' } => c.type === 'position');
      const otherChanges = changes.filter(c => c.type !== 'position');

      let updatedNodes = [...prevNodes];

      // 1. Apply non-position changes (selection, etc.) using standard helper
      if (otherChanges.length > 0) {
        updatedNodes = applyNodeChanges(otherChanges, updatedNodes as Node[]) as SystemNode[];
      }

      // 2. Apply position changes to the correct layout context
      if (positionChanges.length > 0) {
        const contextKey = selectedNodeId || 'global';
        updatedNodes = updatedNodes.map(n => {
          const change = positionChanges.find(c => c.id === n.id);
          if (change && change.position && isEaSystemNode(n)) {
            const layoutPositions = { ...(n.data.layoutPositions || {}) };
            layoutPositions[contextKey] = change.position;

            const patchBody: { layoutPositions: Record<string, { x: number; y: number }>; x?: number; y?: number } = { layoutPositions };
            if (contextKey === 'global') {
              patchBody.x = change.position.x;
              patchBody.y = change.position.y;
            }
            scheduleSave(`position-${n.id}`, () => apiPatch(`/systems/${n.id}`, patchBody));

            return {
              ...n,
              // Update the core position so React Flow sees the move immediately
              position: contextKey === 'global' ? change.position : n.position,
              data: {
                ...n.data,
                layoutPositions
              }
            } as SystemNode;
          }
          return n;
        });
      }

      return updatedNodes;
    });
  }, [selectedNodeId, setNodes, scheduleSave, apiPatch]);

  const objectsInPendingSource = useMemo(() => {
    if (!pendingEdge) return [];

    const sysId = pendingEdge.source;
    const relatedObjects = new Set<string>();

    dataObjects.forEach(o => {
      if (o.masterSystemId === sysId) relatedObjects.add(o.id);
    });

    edges.forEach(e => {
      if (e.source === sysId || e.target === sysId) {
        e.data?.dataObjectIds?.forEach(id => relatedObjects.add(id));
      }
    });

    return dataObjects.filter(o => relatedObjects.has(o.id));
  }, [pendingEdge, dataObjects, edges]);

  const objectsInSelectedSystem = useMemo(
    () => objectsForSystem(selectedNodeId, dataObjects, edges),
    [selectedNodeId, dataObjects, edges]
  );

  return (
    <div className="w-full h-screen flex flex-col relative" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Confidentiality notice - reminds users this is proprietary POC material, not something to reuse independently */}
      <div
        className="absolute bottom-4 left-4 z-50 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm pointer-events-none opacity-60"
        style={{ background: 'var(--bg-header)', color: 'var(--text-on-header)' }}
      >
        Confidential — Proprietary POC, do not distribute
      </div>

      {/* Subtle save banner */}
      {(pendingSaves > 0 || saveSuccess) && (
        <div
          className="absolute bottom-4 right-4 z-50 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm pointer-events-none transition-opacity shadow-[var(--shadow-md)]"
          style={{ background: 'var(--bg-header)', color: 'var(--text-on-header)', opacity: 0.9 }}
        >
          {pendingSaves > 0 ? 'Syncing...' : 'Saved'}
        </div>
      )}

      {/* Pending Edge Modal */}
      {pendingEdge && (
        <div className="absolute inset-0 z-[100] bg-black/40 flex items-center justify-center backdrop-blur-sm">
          <div className={`${cardClass} p-6 w-96 flex flex-col gap-4`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>Assign Data Object to Flow</h3>
              <button
                className="p-1 rounded-full transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => { setPendingEdge(null); setPendingEdgeObject(''); }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              What object is flowing in this connection? (You can type an existing object or a new one, or leave blank)
            </p>
            <input
              autoFocus
              className={inputClass}
              placeholder="e.g. User Profile"
              value={pendingEdgeObject}
              onChange={(e) => setPendingEdgeObject(e.target.value)}
              list="modal-objects-list"
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmPendingEdge();
                if (e.key === 'Escape') { setPendingEdge(null); setPendingEdgeObject(''); }
              }}
            />
            <datalist id="modal-objects-list">
              {objectsInPendingSource.map(o => <option key={o.id} value={o.name} />)}
            </datalist>
            <div className="flex justify-end gap-2 mt-2">
              <button className={buttonSecondaryClass} onClick={() => { setPendingEdge(null); setPendingEdgeObject(''); }}>Cancel</button>
              <button className={buttonPrimaryClass} onClick={confirmPendingEdge}>Save Flow</button>
            </div>
          </div>
        </div>
      )}

      <header
        className="px-5 py-3 flex items-center gap-4 shadow-[var(--shadow-md)] z-20 relative"
        style={{ background: 'var(--bg-header)', color: 'var(--text-on-header)' }}
      >
        <div className="flex items-center gap-2 font-bold text-lg tracking-[var(--heading-tracking)]">
          <LogoMark />
          EA Designer
        </div>

        <div
          className="flex gap-1 items-center p-1 rounded-[var(--radius-card)] ml-auto"
          style={{ background: 'color-mix(in srgb, var(--text-on-header) 12%, transparent)' }}
        >
          <button
            className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-button)] text-sm transition-colors"
            style={view === 'canvas' ? { background: 'var(--bg-surface)', color: 'var(--primary)' } : { color: 'var(--text-on-header)' }}
            onClick={() => setView('canvas')}
          >
            <Workflow size={14} />{t('nav.canvas')}
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-button)] text-sm transition-colors"
            style={view === 'inventory' ? { background: 'var(--bg-surface)', color: 'var(--primary)' } : { color: 'var(--text-on-header)' }}
            onClick={() => setView('inventory')}
          >
            <Table size={14} />{t('nav.inventory')}
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-button)] text-sm transition-colors"
            style={view === 'schedule' ? { background: 'var(--bg-surface)', color: 'var(--primary)' } : { color: 'var(--text-on-header)' }}
            onClick={() => setView('schedule')}
          >
            <Calendar size={14} />{t('nav.schedule')}
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-button)] text-sm transition-colors"
            style={view === 'settings' ? { background: 'var(--bg-surface)', color: 'var(--primary)' } : { color: 'var(--text-on-header)' }}
            onClick={() => setView('settings')}
          >
            <SettingsIcon size={14} />{t('nav.settings')}
          </button>
        </div>

        {user && (
          <div className="flex items-center gap-2 pl-2 text-sm" style={{ color: 'var(--text-on-header)' }}>
            <span className="hidden sm:inline opacity-90 truncate max-w-[140px]" title={user.email}>{user.name}</span>
            <button
              className="p-1.5 rounded-full transition-colors"
              style={{ background: 'color-mix(in srgb, var(--text-on-header) 12%, transparent)' }}
              title={t('nav.logout')}
              onClick={() => logout()}
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </header>

      {/* Canvas-only contextual toolbar - creation and filtering only matter while looking at the
          diagram, so they no longer clutter every other page. */}
      {view === 'canvas' && (
        <div
          className="px-5 py-2.5 flex items-center gap-2 flex-wrap border-b"
          style={{ background: 'var(--bg-surface-alt)', borderColor: 'var(--border)' }}
        >
          {canWrite && (
            <>
              <Popover
                trigger={({ toggle }) => (
                  <button className={buttonSecondaryClass} onClick={toggle}><Plus size={14} />{t('canvas.addSystem')}</button>
                )}
              >
                {(close) => (
                  <div className="flex flex-col gap-3">
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{t('canvas.newSystem')}</h3>
                    <input
                      autoFocus
                      className={inputClass}
                      placeholder={t('canvas.systemNamePlaceholder')}
                      value={newSystemName}
                      onChange={(e) => setNewSystemName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && addSystem()) close(); }}
                    />
                    <button className={buttonPrimaryClass} onClick={() => { if (addSystem()) close(); }}>
                      <Plus size={14} />{t('canvas.addSystem')}
                    </button>
                  </div>
                )}
              </Popover>

              <Popover
                trigger={({ toggle }) => (
                  <button className={buttonSecondaryClass} onClick={toggle}><Plus size={14} />{t('canvas.addObject')}</button>
                )}
              >
                {(close) => (
                  <div className="flex flex-col gap-3">
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{t('canvas.newObject')}</h3>
                    <input
                      autoFocus
                      className={inputClass}
                      placeholder={t('canvas.objectNamePlaceholder')}
                      value={newObjectName}
                      onChange={(e) => setNewObjectName(e.target.value)}
                    />
                    <select
                      className={inputClass}
                      value={newObjectMaster}
                      onChange={(e) => setNewObjectMaster(e.target.value)}
                    >
                      <option value="" disabled>{t('canvas.masterSystemPlaceholder')}</option>
                      {nodes.filter(isEaSystemNode).map(n => <option key={n.id} value={n.data.label}>{n.data.label}</option>)}
                    </select>
                    <button className={buttonPrimaryClass} onClick={() => { if (addObject()) close(); }}>
                      <Plus size={14} />{t('canvas.addObject')}
                    </button>
                  </div>
                )}
              </Popover>

              <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
            </>
          )}

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            <input
              className={`${inputClass} pl-8 w-40`}
              value={filterSystemId}
              onChange={(e) => setFilterSystemId(e.target.value)}
              placeholder={t('canvas.filterBySystem')}
              list="filter-systems-list"
            />
            <datalist id="filter-systems-list">
              {nodes.filter(isEaSystemNode).map(n => <option key={n.id} value={n.id}>{n.data.label}</option>)}
            </datalist>
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            <input
              className={`${inputClass} pl-8 w-40`}
              value={filterObjectId}
              onChange={(e) => setFilterObjectId(e.target.value)}
              placeholder={t('canvas.filterByObject')}
              list="filter-objects-list"
            />
            <datalist id="filter-objects-list">
              {dataObjects.map(o => {
                const systemNames = Object.values(o.systemObjectNames || {}).map(e => e.name).filter(Boolean).join(', ');
                return <option key={o.id} value={o.id}>{o.name} {systemNames ? `(${systemNames})` : ''}</option>;
              })}
            </datalist>
          </div>

          {(filterSystemId || filterObjectId) && (
            <button
              className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-[var(--radius-button)] transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onClick={() => { setFilterSystemId(''); setFilterObjectId(''); }}
            >
              <X size={12} />Clear filters
            </button>
          )}
        </div>
      )}

      {view === 'inventory' ? (
        <InventoryView
          onSelectSystem={handleInventorySelect}
          onViewObject={handleViewObjectInCanvas}
          dataObjects={dataObjects}
          getSystemLabel={getSystemLabel}
          nodes={nodes}
          edges={edges}
          renameSystem={renameSystem}
          updateSystemField={updateSystemField}
          setSystemObjectName={setSystemObjectName}
          deleteObject={deleteObject}
          deleteSystem={deleteSystem}
          renameObjectGlobal={renameObjectGlobal}
          updateObjectField={updateObjectField}
          canWrite={canWrite}
          integrationTypes={integrationTypes}
          integrationSoftwareList={integrationSoftwareList}
          onAddReferenceItem={handleAddReferenceItem}
          onRenameReferenceItem={handleRenameReferenceItem}
          onUpdateSoftwareTimeZone={handleUpdateSoftwareTimeZone}
          findReferenceItemUsage={findReferenceItemUsage}
          onResolveAndDeleteReferenceItem={handleResolveAndDeleteReferenceItem}
          subView={inventoryTab}
          setSubView={setInventoryTab}
          editingSystemId={inventoryEditingSystemId}
          setEditingSystemId={setInventoryEditingSystemId}
          editingObjectId={inventoryEditingObjectId}
          setEditingObjectId={setInventoryEditingObjectId}
          currentUserId={user?.id}
          teamRoster={teamRoster}
        />
      ) : view === 'schedule' ? (
        <ScheduleView
          nodes={nodes}
          edges={edges}
          dataObjects={dataObjects}
          edgeObjectDetails={edgeObjectDetails}
          systemDowntimes={systemDowntimes}
          getSystemLabel={getSystemLabel}
          getSystemTimeZone={getSystemTimeZone}
          canWrite={canWrite}
          onAddDowntime={addDowntime}
          onDeleteDowntime={deleteDowntime}
        />
      ) : view === 'settings' ? (
        <SettingsView />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 relative" style={{ background: 'var(--bg-canvas)' }}>
          <ReactFlow
            nodes={processedNodes}
            edges={processedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onContextAwareNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={(_, edge) => {
              const pair = resolveEdgePair(edge);
              if (!pair) return; // a junction's aggregate hub edge fans into several remotes at once - nothing single to open
              setSelectedEdgePair(pair);
              setSelectedNodeId(null);
              setSelectedObjectIdSidebar(null);
            }}
            onNodeClick={(_, node) => {
              if (node.type === 'junction') return;
              setSelectedNodeId(node.id);
              setSelectedEdgePair(null);
              setSelectedObjectIdSidebar(null);
            }}
            onPaneClick={() => {
              setSelectedEdgePair(null);
              setSelectedNodeId(null);
              setSelectedObjectIdSidebar(null);
            }}
            connectionMode={ConnectionMode.Loose}
            nodesDraggable={canWrite}
            nodesConnectable={canWrite}
            fitView
          >
            <Controls />
            <Background color={tokens.canvasDotColor} gap={16} />
          </ReactFlow>
        </div>

        {/* Right Sidebar */}
        <div
          className="w-80 p-4 border-l overflow-y-auto flex flex-col gap-4 z-10 relative"
          style={{ background: 'var(--bg-surface-alt)', borderColor: 'var(--border)' }}
        >

          {selectedEdgePair && primaryEdge ? (
            <>
              <h2 className={panelHeadingClass}>{t('connection.data')}</h2>
              {selectedEdgeGroup.length > 1 && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  This connection is backed by {selectedEdgeGroup.length} separate integration records; the description below is the first one's.
                </p>
              )}

              <div>
                <label className={labelClass}>{t('common.description')}</label>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={primaryEdge.data?.description || ''}
                  disabled={!canWrite}
                  onChange={(e) => updateEdgeField(primaryEdge.id, 'description', e.target.value, `edge-desc-${primaryEdge.id}`)}
                  placeholder={t('connection.description')}
                />
              </div>

              <OwnerPicker
                ownerIds={primaryEdge.data?.ownerIds || []}
                roster={teamRoster}
                canManage={canWrite || !!(user && (primaryEdge.data?.ownerIds || []).includes(user.id))}
                onChange={(ids) => updateEdgeField(primaryEdge.id, 'ownerIds', ids)}
              />

              <div className="text-sm border-t pt-4" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>
                {t('connection.selectObjectsBlurb')}
              </div>

              {dataObjects.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Add data objects first.</p>}

              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder={t('connection.searchObjects')}
                  className={`${inputClass} pl-8 mb-2`}
                  value={connectionObjectSearch}
                  onChange={e => setConnectionObjectSearch(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
                {dataObjects
                  .filter(obj => {
                    const isActive = obj.id in objectEdgeMap;
                    if (isActive) return true; // Always show selected objects
                    if (!connectionObjectSearch) return true;
                    const search = connectionObjectSearch.toLowerCase();
                    if (obj.name.toLowerCase().includes(search)) return true;
                    return Object.values(obj.systemObjectNames || {}).some(entry =>
                      entry.name.toLowerCase().includes(search) || (entry.objectId || '').toLowerCase().includes(search)
                    );
                  })
                  .slice(0, 100) // Render limit for performance
                  .map((obj) => {
                  const isActive = obj.id in objectEdgeMap;
                  // The specific raw edge that carries this object (falling back to the group's
                  // first edge for one not yet on any of them) - per-object detail and the
                  // add/remove toggle both key off this, not the pair as a whole.
                  const owningEdgeId = objectEdgeMap[obj.id] || primaryEdge.id;
                  const owningEdge = selectedEdgeGroup.find(e => e.id === owningEdgeId) || primaryEdge;
                  const detail = getEdgeObjectDetail(owningEdgeId, obj.id);
                  return (
                    <div key={obj.id} className={`${listItemCardClass} flex flex-col gap-2 px-2 py-1.5`}>
                      <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                        <input
                          type="checkbox"
                          checked={isActive || false}
                          disabled={!canWrite}
                          onChange={() => toggleObjectOnEdge(owningEdgeId, obj.id)}
                        />
                        <span className="truncate font-semibold text-sm" title={obj.name}>{obj.name}</span>
                      </label>

                      {isActive && (
                        <div className="flex flex-col gap-2 pt-2 pl-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                          <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold" style={{ color: detail.atRisk ? 'var(--danger)' : 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={detail.atRisk || false}
                              disabled={!canWrite}
                              onChange={(e) => updateEdgeObjectDetail(owningEdgeId, obj.id, 'atRisk', e.target.checked)}
                            />
                            <AlertTriangle size={13} />
                            {t('connection.atRisk')}
                          </label>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>
                                {t('connection.patternAt', { system: getSystemLabel(owningEdge.source) || 'source' })}
                              </label>
                              <select
                                className={`${inputClass} px-1.5 py-1 text-xs`}
                                value={detail.sourcePattern || ''}
                                disabled={!canWrite}
                                onChange={(e) => updateEdgeObjectDetail(owningEdgeId, obj.id, 'sourcePattern', e.target.value)}
                              >
                                <option value="">{t('common.unspecified')}</option>
                                {INTEGRATION_PATTERN_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>
                                {t('connection.patternAt', { system: getSystemLabel(owningEdge.target) || 'target' })}
                              </label>
                              <select
                                className={`${inputClass} px-1.5 py-1 text-xs`}
                                value={detail.targetPattern || ''}
                                disabled={!canWrite}
                                onChange={(e) => updateEdgeObjectDetail(owningEdgeId, obj.id, 'targetPattern', e.target.value)}
                              >
                                <option value="">{t('common.unspecified')}</option>
                                {INTEGRATION_PATTERN_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold mb-1" style={{ color: 'var(--text-muted)' }}>
                              {t('connection.frequency')} <span style={{ color: 'var(--danger)' }}>*</span>
                            </label>
                            <ScheduleEditor
                              schedule={detail.schedule || DEFAULT_SCHEDULE}
                              canWrite={canWrite}
                              onChange={(schedule) => updateEdgeObjectDetail(owningEdgeId, obj.id, 'schedule', schedule)}
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('connection.integrationType')}</label>
                            <select
                              className={`${inputClass} px-1.5 py-1 text-xs`}
                              value={detail.integrationTypeId || ''}
                              disabled={!canWrite}
                              onChange={(e) => updateEdgeObjectDetail(owningEdgeId, obj.id, 'integrationTypeId', e.target.value)}
                            >
                              <option value="">{t('common.unspecified')}</option>
                              {integrationTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            {integrationTypes.length === 0 && (
                              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('common.noneDefinedYet')}</span>
                            )}
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('connection.integrationSoftware')}</label>
                            <select
                              className={`${inputClass} px-1.5 py-1 text-xs`}
                              value={detail.integrationSoftwareId || ''}
                              disabled={!canWrite}
                              onChange={(e) => updateEdgeObjectDetail(owningEdgeId, obj.id, 'integrationSoftwareId', e.target.value)}
                            >
                              <option value="">{t('common.unspecified')}</option>
                              {integrationSoftwareList.map(item => <option key={item.id} value={item.id}>{`${item.name} (${item.timeZone || 'UTC'})`}</option>)}
                            </select>
                            {integrationSoftwareList.length === 0 && (
                              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('common.noneDefinedYet')}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {canWrite && (
                <button
                  className={`${buttonDangerClass} mt-8`}
                  onClick={deleteSelectedEdge}
                >
                  <Trash2 size={14} />{t('connection.deleteConnection')}
                </button>
              )}
            </>
          ) : selectedNodeId ? (
            <SystemDetailsPanel
              systemId={selectedNodeId}
              data={selectedSystemData}
              objectsInSystem={objectsInSelectedSystem}
              renameSystem={renameSystem}
              updateSystemField={updateSystemField}
              setSystemObjectName={setSystemObjectName}
              deleteObject={deleteObject}
              onDelete={() => { deleteSystem(selectedNodeId); setSelectedNodeId(null); }}
              readOnly={!canWrite}
              teamRoster={teamRoster}
              canManageOwners={canWrite || !!(user && (selectedSystemData?.ownerIds || []).includes(user.id))}
            />
          ) : selectedObject ? (
            <ObjectDetailsPanel
              object={selectedObject}
              systemNodes={nodes}
              getSystemLabel={getSystemLabel}
              onBack={() => setSelectedObjectIdSidebar(null)}
              renameObjectGlobal={renameObjectGlobal}
              updateObjectField={updateObjectField}
              setSystemObjectName={setSystemObjectName}
              onDelete={() => { deleteObject(selectedObject.id); setSelectedObjectIdSidebar(null); }}
              readOnly={!canWrite}
            />
          ) : (
            <div className="flex flex-col items-center text-center gap-2 mt-12 px-4">
              <MousePointerClick size={28} style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('canvas.nothingSelected')}</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('canvas.nothingSelectedBlurb')}
              </p>
            </div>
          )}

        </div>
      </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <NdaGate>
        <AppContent />
      </NdaGate>
    </AuthGate>
  );
}
