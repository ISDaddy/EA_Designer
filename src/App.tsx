import React, { useState, useMemo, useCallback, useRef } from 'react';
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

const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || '4001';
// Use the host the app was loaded from (not a hardcoded "localhost") so this also works
// when the app is accessed via a LAN IP or a real domain, not just from the server itself.
const API_BASE = `http://${window.location.hostname}:${BACKEND_PORT}/api`;

// Enterprise Architecture styled Custom Node
const EASystemNode = ({ data }: { data: SystemNodeData }) => {
  return (
    <div className={`relative bg-[#d3e3f1] border-2 rounded shadow-md min-w-[150px] min-h-[60px] flex items-center justify-center p-3 group hover:shadow-lg transition-shadow ${data.isHighlighted ? 'border-yellow-400 shadow-yellow-200 ring-2 ring-yellow-400' : 'border-[#5b8cbe]'}`}>
      {/* ArchiMate Application Component icon hint (two small boxes on top-left) */}
      <div className="absolute top-1 left-1 flex flex-col gap-0.5">
        <div className="w-2 h-1 border border-[#5b8cbe]"></div>
        <div className="w-2 h-1 border border-[#5b8cbe]"></div>
      </div>

      <div className="absolute top-1 left-2.5 w-3 h-2.5 border border-[#5b8cbe]"></div>

      {data.criticality === 'critical' && (
        <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-500 border-2 border-white" title="Critical system" />
      )}

      <div className="font-bold text-[#1f497d] text-center mt-2 whitespace-pre-wrap">{data.label}</div>
      {data.status && data.status !== 'active' && (
        <div className="absolute bottom-1 right-1 text-[9px] font-bold uppercase text-slate-500 bg-white/70 px-1 rounded">
          {data.status}
        </div>
      )}

      {/* Multiple invisible connection ports dynamically snapped to by the custom routing logic */}
      {[Position.Top, Position.Bottom, Position.Left, Position.Right].map(pos =>
        [50, 25, 75, 10, 90, 40, 60].map(pct => {
          const isVertical = pos === Position.Top || pos === Position.Bottom;
          const style = isVertical ? { left: `${pct}%` } : { top: `${pct}%` };
          // The center handle (50) is visible, the others are invisible grid anchors
          const isCenter = pct === 50;
          return (
            <React.Fragment key={`${pos}-${pct}`}>
              <Handle
                type="target"
                position={pos}
                id={`t-${pos}-${pct}`}
                style={{...style, zIndex: 0}}
                className="opacity-0 w-1 h-1 absolute pointer-events-none"
              />
              <Handle
                type="source"
                position={pos}
                id={`s-${pos}-${pct}`}
                style={{...style, zIndex: 1}}
                className={isCenter ? "w-2 h-2 bg-[#5b8cbe] border-2 border-white rounded-full opacity-50 group-hover:opacity-100 transition-opacity" : "opacity-0 w-1 h-1"}
              />
            </React.Fragment>
          );
        })
      )}
    </div>
  );
};

const JunctionNode = () => (
  <div className="bg-slate-400 rounded-full w-3 h-3 shadow border-2 border-white relative">
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

type SystemNodeData = {
  label: string;
  layoutPositions?: Record<string, { x: number; y: number }>;
  isHighlighted?: boolean;
  owner?: string;
  status?: SystemStatus;
  criticality?: Criticality;
  businessCapability?: string;
  techStack?: string[];
  description?: string;
};

type SystemNode = Node<SystemNodeData, 'eaSystem'> | Node<Record<string, never>, 'junction'>;
type IntegrationEdgeData = {
  dataObjectIds: string[];
  description?: string;
  integrationPattern?: string;
  frequency?: string;
};
type IntegrationEdge = Edge<IntegrationEdgeData>;

// `nodes.filter(n => n.type === 'eaSystem')` doesn't narrow the array's element type (only a type
// predicate does), so call sites used to fall back to `as any` to reach `.data.label`. This guard
// lets them narrow properly instead.
const isEaSystemNode = (n: Node | null | undefined): n is Node<SystemNodeData, 'eaSystem'> =>
  !!n && n.type === 'eaSystem';

type RawSystemRow = {
  id: string; label: string; x: number; y: number;
  layout_positions?: Record<string, { x: number; y: number }>;
  owner?: string; status?: string; criticality?: string;
  business_capability?: string; tech_stack?: string[]; description?: string;
};
type RawDataObjectRow = {
  id: string; name: string; master_system_id: string;
  aliases?: Record<string, string>; description?: string; classification?: string;
};
type RawEdgeRow = {
  id: string; source: string; target: string; data_object_ids: string[];
  description?: string; integration_pattern?: string; frequency?: string;
};

type DataObject = {
  id: string;
  name: string;
  masterSystemId: string;
  aliases?: Record<string, string>; // systemId -> alias
  description?: string;
  classification?: DataObjectClassification;
};

const STATUS_LABELS: Record<SystemStatus, string> = { planned: 'Planned', active: 'Active', deprecated: 'Deprecated', retired: 'Retired' };
const STATUS_BADGE_STYLES: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  deprecated: 'bg-amber-100 text-amber-800',
  retired: 'bg-slate-200 text-slate-600',
};
const CRITICALITY_LABELS: Record<Criticality, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const CRITICALITY_BADGE_STYLES: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

const inputClass = 'w-full px-2 py-1 border border-slate-300 bg-white shadow-inner rounded text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none';

// A filterable, paginated table over the systems the backend holds - the practical way to browse
// a landscape of hundreds or thousands of systems, since rendering that many boxes on one canvas
// stops being usable long before a real enterprise's system count does.
type InventoryRow = {
  id: string; label: string; owner: string; status: string; criticality: string;
  business_capability: string; description: string;
};

function InventoryView({ onSelectSystem }: { onSelectSystem: (id: string) => void }) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [criticalityFilter, setCriticalityFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 25;

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

      fetch(`${API_BASE}/systems?${params.toString()}`)
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
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-lg font-bold mb-4 text-slate-800">System Inventory</h2>
        <div className="flex gap-2 mb-4 flex-wrap">
          <input
            className="px-3 py-1.5 border border-slate-300 rounded shadow-sm w-64"
            placeholder="Search by name, owner, capability..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="px-3 py-1.5 border border-slate-300 rounded shadow-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="px-3 py-1.5 border border-slate-300 rounded shadow-sm" value={criticalityFilter} onChange={e => setCriticalityFilter(e.target.value)}>
            <option value="">All criticalities</option>
            {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <div className="bg-white rounded shadow border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">System</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Criticality</th>
                <th className="px-4 py-2">Business Capability</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer" onClick={() => onSelectSystem(r.id)}>
                  <td className="px-4 py-2 font-bold text-slate-800">{r.label}</td>
                  <td className="px-4 py-2 text-slate-600">{r.owner || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE_STYLES[r.status] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABELS[r.status as SystemStatus] || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${CRITICALITY_BADGE_STYLES[r.criticality] || 'bg-slate-100 text-slate-600'}`}>
                      {CRITICALITY_LABELS[r.criticality as Criticality] || r.criticality}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{r.business_capability || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No systems match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
          <span>{loading ? 'Loading...' : `Showing ${from}-${to} of ${total}`}</span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <button
              className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-40"
              disabled={to >= total}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [nodes, setNodes] = useNodesState<SystemNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<IntegrationEdge>([]);
  const [dataObjects, setDataObjects] = useState<DataObject[]>([]);
  const [view, setView] = useState<'canvas' | 'inventory'>('canvas');

  const [newSystemName, setNewSystemName] = useState('');
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectMaster, setNewObjectMaster] = useState('');

  // Load from DB on mount
  React.useEffect(() => {
    fetch(`${API_BASE}/state`)
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
              owner: s.owner || '',
              status: (s.status as SystemStatus) || 'active',
              criticality: (s.criticality as Criticality) || 'medium',
              businessCapability: s.business_capability || '',
              techStack: s.tech_stack || [],
              description: s.description || '',
            }
          })));
        }
        if (data.dataObjects) {
          setDataObjects(data.dataObjects.map((o: RawDataObjectRow) => ({
            id: o.id,
            name: o.name,
            masterSystemId: o.master_system_id,
            aliases: o.aliases || {},
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
              integrationPattern: e.integration_pattern || '',
              frequency: e.frequency || '',
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#b1b1b7' },
            style: { stroke: '#b1b1b7', strokeWidth: 2 },
          })));
        }
      })
      .catch(err => console.error('Failed to load state', err));
  }, [setNodes, setEdges]);

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
      await fetch(`${API_BASE}${path}`, options);
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

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedObjectIdSidebar, setSelectedObjectIdSidebar] = useState<string | null>(null);
  const [pendingEdge, setPendingEdge] = useState<Connection | null>(null);
  const [pendingEdgeObject, setPendingEdgeObject] = useState<string>('');

  const [filterSystemId, setFilterSystemId] = useState<string>('');
  const [filterObjectId, setFilterObjectId] = useState<string>('');

  // UI state for massive lists
  const [sidebarObjectSearch, setSidebarObjectSearch] = useState('');
  const [connectionObjectSearch, setConnectionObjectSearch] = useState('');

  const addSystem = useCallback(() => {
    if (!newSystemName) return;
    if (nodes.some(n => isEaSystemNode(n) && n.data.label.toLowerCase() === newSystemName.trim().toLowerCase())) {
      alert('A system with this name already exists.');
      return;
    }
    const position = { x: Math.random() * 400, y: Math.random() * 400 };
    const newNode: SystemNode = {
      id: `sys-${Date.now()}`,
      type: 'eaSystem',
      data: {
        label: newSystemName.trim(),
        layoutPositions: { 'global': position },
        owner: '',
        status: 'active',
        criticality: 'medium',
        businessCapability: '',
        techStack: [],
        description: '',
      },
      position,
    };
    setNodes((nds) => [...nds, newNode]);
    setNewSystemName('');
    apiPost('/systems', {
      id: newNode.id, label: newNode.data.label, x: position.x, y: position.y,
      layoutPositions: newNode.data.layoutPositions,
    });
  }, [newSystemName, nodes, setNodes, apiPost]);

  const addObject = useCallback(() => {
    if (!newObjectName || !newObjectMaster) {
      alert('Please provide both an object name and a master system.');
      return;
    }
    if (dataObjects.some(o => o.name.toLowerCase() === newObjectName.trim().toLowerCase())) {
      alert('A data object with this name already exists.');
      return;
    }

    const masterName = newObjectMaster.trim();
    let masterNode = nodes.find(n => isEaSystemNode(n) && n.data.label.toLowerCase() === masterName.toLowerCase());

    // Create master system if it doesn't exist
    if (!masterNode) {
      const position = { x: Math.random() * 400, y: Math.random() * 400 };
      masterNode = {
        id: `sys-${Date.now()}`,
        type: 'eaSystem',
        data: {
          label: masterName,
          layoutPositions: { global: position },
          owner: '', status: 'active', criticality: 'medium', businessCapability: '', techStack: [], description: '',
        },
        position,
      };
      setNodes((nds) => [...nds, masterNode!]);
      apiPost('/systems', { id: masterNode.id, label: masterName, x: position.x, y: position.y, layoutPositions: { global: position } });
    }

    const newObject: DataObject = {
      id: `obj-${Date.now()}`,
      name: newObjectName.trim(),
      masterSystemId: masterNode!.id,
      aliases: {},
      description: '',
      classification: 'internal',
    };
    setDataObjects((objs) => [...objs, newObject]);
    apiPost('/data-objects', { id: newObject.id, name: newObject.name, masterSystemId: newObject.masterSystemId });
    setNewObjectName('');
    setNewObjectMaster('');
  }, [newObjectName, newObjectMaster, dataObjects, nodes, setNodes, apiPost]);

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
        const newObject: DataObject = { id: objectId, name: objName, masterSystemId: pendingEdge.source, aliases: {}, description: '', classification: 'internal' };
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

    const newEdge: IntegrationEdge = {
      ...pendingEdge,
      sourceHandle: finalSourceHandle,
      targetHandle: finalTargetHandle,
      id: `edge-${Date.now()}`,
      data: { dataObjectIds: objectId ? [objectId] : [], description: '', integrationPattern: '', frequency: '' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#b1b1b7' },
      style: { stroke: '#b1b1b7', strokeWidth: 2 },
    };

    setEdges((eds) => addEdge(newEdge, eds));
    apiPost('/edges', {
      id: newEdge.id, source: newEdge.source, target: newEdge.target,
      dataObjectIds: newEdge.data!.dataObjectIds,
    });
    setPendingEdge(null);
    setPendingEdgeObject('');

    // Optionally open the right sidebar for this edge
    setSelectedEdgeId(newEdge.id);
    setSelectedNodeId(null);
  }, [pendingEdge, pendingEdgeObject, dataObjects, nodes, getClosestHandles, setDataObjects, setEdges, apiPost]);

  const toggleObjectOnEdge = useCallback((edgeId: string, objectId: string) => {
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id === edgeId) {
          const currentIds = e.data?.dataObjectIds || [];
          const newIds = currentIds.includes(objectId)
            ? currentIds.filter((id) => id !== objectId)
            : [...currentIds, objectId];
          apiPatch(`/edges/${edgeId}`, { dataObjectIds: newIds });
          return { ...e, data: { ...e.data, dataObjectIds: newIds } };
        }
        return e;
      })
    );
  }, [setEdges, apiPatch]);

  const deleteSelectedEdge = useCallback(() => {
    if (selectedEdgeId) {
      apiDelete(`/edges/${selectedEdgeId}`);
      setEdges((eds) => eds.filter(e => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  }, [selectedEdgeId, setEdges, apiDelete]);

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

  const setSystemAlias = useCallback((objId: string, sysId: string, alias: string) => {
    setDataObjects(objs => objs.map(o => {
      if (o.id === objId) {
        const aliases = { ...(o.aliases || {}), [sysId]: alias };
        scheduleSave(`object-aliases-${objId}`, () => apiPatch(`/data-objects/${objId}`, { aliases }));
        return { ...o, aliases };
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

  const handleInventorySelect = useCallback((sysId: string) => {
    setSelectedNodeId(sysId);
    setSelectedEdgeId(null);
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

  const getAlias = useCallback((objId: string, sysId: string) => {
    const obj = dataObjects.find(o => o.id === objId);
    if (!obj) return '';
    return obj.aliases?.[sysId] || obj.name;
  }, [dataObjects]);

  const getSystemLabel = useCallback((sysId: string | null | undefined) => {
    const node = nodes.find(n => n.id === sysId);
    return isEaSystemNode(node) ? node.data.label : undefined;
  }, [nodes]);

  const { processedNodes, processedEdges } = useMemo(() => {
    let finalNodes: Node[] = [...nodes.filter(n => n.type !== 'junction')]; // Base system nodes
    let finalEdges: Edge[] = [];
    const hiddenOriginalEdges = new Set<string>();

    // 1. Apply Junction Pattern if a node is selected
    if (selectedNodeId) {
      const selectedNode = finalNodes.find(n => n.id === selectedNodeId);
      if (selectedNode) {
        // For a given direction, every remote system must contribute exactly one line into/out of
        // the selected node - otherwise a remote with several differently-aliased flows ends up
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
            remoteLocalLabel.set(remoteId, Array.from(objIds).map(id => getAlias(id, selectedNodeId)).join(', ') || 'Unknown');
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
            // aliases differ from the selected node's naming - and is drawn as a normal
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
            const color = hasConflict ? 'red' : '#b1b1b7';
            const strokeWidth = hasConflict ? 3 : 2;
            const baseEdgeStyle = {
              type: 'smoothstep',
              style: { stroke: color, strokeWidth },
              labelStyle: { fill: color, fontWeight: 700, fontSize: 11 },
              labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9, stroke: color, strokeWidth: 1 },
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
                const remoteLabel = Array.from(remoteObjIds).map(id => getAlias(id, remoteId)).join(', ');
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
                const remoteLabel = Array.from(remoteObjIds).map(id => getAlias(id, remoteId)).join(', ');
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
      const hasConflict = group.some(ge => ge.data?.dataObjectIds?.some(id => objectsWithMultipleMasters.has(id)));
      const color = hasConflict ? 'red' : '#b1b1b7';
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
        const labels = e.data?.dataObjectIds?.map(id => getAlias(id, e.source)).join(', ') || '';
        finalEdges.push({
          ...e,
          sourceHandle: sHandle,
          targetHandle: tHandle,
          label: labels,
          type: 'smoothstep',
          style: { stroke: color, strokeWidth },
          labelStyle: { fill: color, fontWeight: 700, fontSize: 11 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9, stroke: color, strokeWidth: 1 },
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
          ge.data?.dataObjectIds?.forEach(id => allLabels.add(getAlias(id, ge.source)));
        });

        const labels = Array.from(allLabels).filter(Boolean);
        const displayLabel = labels.length > 3 ? `${labels.length} flows` : labels.join(', ');

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
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9, stroke: color, strokeWidth: 1 },
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
  }, [nodes, edges, dataObjects, objectsWithMultipleMasters, filterSystemId, filterObjectId, selectedNodeId, getAlias, getClosestHandles]);

  const selectedEdge = edges.find(e => e.id === selectedEdgeId);
  const selectedSystemNode = nodes.find(n => n.id === selectedNodeId);
  const selectedSystemData = isEaSystemNode(selectedSystemNode) ? selectedSystemNode.data : undefined;
  const selectedObject = selectedObjectIdSidebar ? dataObjects.find(o => o.id === selectedObjectIdSidebar) : undefined;

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

  const objectsInSelectedSystem = useMemo(() => {
    if (!selectedNodeId) return [];

    const relatedObjects = new Set<string>();

    // Objects where this system is master
    dataObjects.forEach(o => {
      if (o.masterSystemId === selectedNodeId) relatedObjects.add(o.id);
    });

    // Objects flowing in/out of this system
    edges.forEach(e => {
      if (e.source === selectedNodeId || e.target === selectedNodeId) {
        e.data?.dataObjectIds?.forEach(id => relatedObjects.add(id));
      }
    });

    return dataObjects.filter(o => relatedObjects.has(o.id));
  }, [selectedNodeId, dataObjects, edges]);

  return (
    <div className="w-full h-screen flex flex-col font-sans relative">
      {/* Subtle save banner */}
      {(pendingSaves > 0 || saveSuccess) && (
        <div className="absolute bottom-4 right-4 z-50 bg-slate-800/80 text-white/70 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm pointer-events-none transition-opacity">
          {pendingSaves > 0 ? 'Syncing...' : 'Saved'}
        </div>
      )}

      {/* Pending Edge Modal */}
      {pendingEdge && (
        <div className="absolute inset-0 z-[100] bg-black/40 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded shadow-xl w-96 flex flex-col gap-4">
            <h3 className="font-bold text-lg">Assign Data Object to Flow</h3>
            <p className="text-sm text-slate-600">
              What object is flowing in this connection? (You can type an existing object or a new one, or leave blank)
            </p>
            <input
              autoFocus
              className="px-3 py-2 border border-slate-300 bg-white shadow-inner rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
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
              <button className="px-4 py-2 bg-slate-200 rounded hover:bg-slate-300" onClick={() => { setPendingEdge(null); setPendingEdgeObject(''); }}>Cancel</button>
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" onClick={confirmPendingEdge}>Save Flow</button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-slate-800 text-white p-4 flex gap-6 items-center flex-wrap shadow-md z-10 relative">
        <div className="font-bold text-xl flex items-center gap-4">
          EA Designer
        </div>

        <div className="flex gap-2 items-center bg-slate-700 p-2 rounded">
          <input
            className="px-2 py-1 text-black rounded"
            value={newSystemName}
            onChange={(e) => setNewSystemName(e.target.value)}
            placeholder="New System Name"
          />
          <button className="bg-blue-500 px-3 py-1 rounded hover:bg-blue-600" onClick={addSystem}>Add System</button>
        </div>

        <div className="flex gap-2 items-center bg-slate-700 p-2 rounded">
          <input
            className="px-2 py-1 text-black rounded w-32"
            value={newObjectName}
            onChange={(e) => setNewObjectName(e.target.value)}
            placeholder="Object Name"
          />
          <select
            className="px-2 py-1 text-black rounded w-32"
            value={newObjectMaster}
            onChange={(e) => setNewObjectMaster(e.target.value)}
          >
            <option value="" disabled>Master System</option>
            {nodes.filter(isEaSystemNode).map(n => <option key={n.id} value={n.data.label}>{n.data.label}</option>)}
          </select>
          <button className="bg-blue-500 px-3 py-1 rounded hover:bg-blue-600" onClick={addObject}>Add Object</button>
        </div>

        <div className="flex gap-2 items-center bg-slate-700 p-2 rounded">
          <span className="text-sm">Filter:</span>
          <input
            className="px-2 py-1 text-black rounded w-32"
            value={filterSystemId}
            onChange={(e) => setFilterSystemId(e.target.value)}
            placeholder="System Filter"
            list="filter-systems-list"
          />
          <datalist id="filter-systems-list">
            {nodes.filter(isEaSystemNode).map(n => <option key={n.id} value={n.id}>{n.data.label}</option>)}
          </datalist>

          <input
            className="px-2 py-1 text-black rounded w-32"
            value={filterObjectId}
            onChange={(e) => setFilterObjectId(e.target.value)}
            placeholder="Object Filter"
            list="filter-objects-list"
          />
          <datalist id="filter-objects-list">
            {dataObjects.map(o => {
              const aliasValues = Object.values(o.aliases || {}).join(', ');
              return <option key={o.id} value={o.id}>{o.name} {aliasValues ? `(${aliasValues})` : ''}</option>;
            })}
          </datalist>
        </div>

        <div className="flex gap-1 items-center bg-slate-700 p-1 rounded ml-auto">
          <button
            className={`px-3 py-1 rounded text-sm ${view === 'canvas' ? 'bg-blue-500' : 'hover:bg-slate-600'}`}
            onClick={() => setView('canvas')}
          >
            Canvas
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${view === 'inventory' ? 'bg-blue-500' : 'hover:bg-slate-600'}`}
            onClick={() => setView('inventory')}
          >
            Inventory
          </button>
        </div>
      </header>

      {view === 'inventory' ? (
        <InventoryView onSelectSystem={handleInventorySelect} />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 relative bg-slate-50">
          <ReactFlow
            nodes={processedNodes}
            edges={processedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onContextAwareNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
              setSelectedObjectIdSidebar(null);
            }}
            onNodeClick={(_, node) => {
              if (node.type === 'junction') return;
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
              setSelectedObjectIdSidebar(null);
            }}
            onPaneClick={() => {
              setSelectedEdgeId(null);
              setSelectedNodeId(null);
              setSelectedObjectIdSidebar(null);
            }}
            connectionMode={ConnectionMode.Loose}
            fitView
          >
            <Controls />
            <Background color="#ccc" gap={16} />
          </ReactFlow>
        </div>

        {/* Right Sidebar */}
        <div className="w-80 bg-slate-100 p-4 border-l border-slate-300 overflow-y-auto flex flex-col gap-4 shadow-inner z-10 relative">

          {selectedEdgeId && selectedEdge ? (
            <>
              <h2 className="font-bold text-lg border-b pb-2">Connection Data</h2>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold mb-1">Integration Pattern</label>
                  <select
                    className={inputClass}
                    value={selectedEdge.data?.integrationPattern || ''}
                    onChange={(e) => updateEdgeField(selectedEdge.id, 'integrationPattern', e.target.value)}
                  >
                    <option value="">Unspecified</option>
                    <option value="rest-api">REST API</option>
                    <option value="soap-api">SOAP API</option>
                    <option value="message-queue">Message Queue / Kafka</option>
                    <option value="file-transfer">File Transfer (SFTP/etc.)</option>
                    <option value="database">Direct Database</option>
                    <option value="manual">Manual</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Frequency</label>
                  <select
                    className={inputClass}
                    value={selectedEdge.data?.frequency || ''}
                    onChange={(e) => updateEdgeField(selectedEdge.id, 'frequency', e.target.value)}
                  >
                    <option value="">Unspecified</option>
                    <option value="real-time">Real-time</option>
                    <option value="batch-hourly">Batch - Hourly</option>
                    <option value="batch-daily">Batch - Daily</option>
                    <option value="batch-weekly">Batch - Weekly</option>
                    <option value="manual">Manual / Ad-hoc</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Description</label>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={selectedEdge.data?.description || ''}
                  onChange={(e) => updateEdgeField(selectedEdge.id, 'description', e.target.value, `edge-desc-${selectedEdge.id}`)}
                  placeholder="What does this integration do?"
                />
              </div>

              <div className="text-sm text-slate-600 border-t pt-4">
                Select which objects are transferred in this integration.
              </div>

              {dataObjects.length === 0 && <p className="text-sm text-slate-500">Add data objects first.</p>}

              <input
                type="text"
                placeholder="Search objects..."
                className="w-full px-2 py-1 border border-slate-300 bg-white shadow-inner rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none mb-2"
                value={connectionObjectSearch}
                onChange={e => setConnectionObjectSearch(e.target.value)}
              />

              <div className="flex flex-col gap-2 max-h-[35vh] overflow-y-auto">
                {dataObjects
                  .filter(obj => {
                    const isActive = selectedEdge.data?.dataObjectIds?.includes(obj.id);
                    if (isActive) return true; // Always show selected objects
                    if (!connectionObjectSearch) return true;
                    const search = connectionObjectSearch.toLowerCase();
                    if (obj.name.toLowerCase().includes(search)) return true;
                    return Object.values(obj.aliases || {}).some(alias => alias.toLowerCase().includes(search));
                  })
                  .slice(0, 100) // Render limit for performance
                  .map((obj) => {
                  const isActive = selectedEdge.data?.dataObjectIds?.includes(obj.id);
                  return (
                    <label key={obj.id} className="flex items-center gap-2 cursor-pointer bg-white p-2 rounded border shadow-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={isActive || false}
                        onChange={() => toggleObjectOnEdge(selectedEdge.id, obj.id)}
                      />
                      <span className="truncate" title={obj.name}>{obj.name}</span>
                    </label>
                  );
                })}
              </div>

              <button
                className="mt-8 bg-red-500 text-white px-3 py-2 rounded hover:bg-red-600"
                onClick={deleteSelectedEdge}
              >
                Delete Connection
              </button>
            </>
          ) : selectedNodeId ? (
            <>
              <h2 className="font-bold text-lg border-b pb-2">System Details</h2>
              <div>
                <label className="block text-xs font-bold mb-1">System Name</label>
                <input
                  type="text"
                  className={inputClass}
                  value={getSystemLabel(selectedNodeId) || ''}
                  onChange={(e) => renameSystem(selectedNodeId, e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold mb-1">Status</label>
                  <select
                    className={inputClass}
                    value={selectedSystemData?.status || 'active'}
                    onChange={(e) => updateSystemField(selectedNodeId, 'status', e.target.value as SystemStatus)}
                  >
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Criticality</label>
                  <select
                    className={inputClass}
                    value={selectedSystemData?.criticality || 'medium'}
                    onChange={(e) => updateSystemField(selectedNodeId, 'criticality', e.target.value as Criticality)}
                  >
                    {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Owner</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. Finance IT Team"
                  value={selectedSystemData?.owner || ''}
                  onChange={(e) => updateSystemField(selectedNodeId, 'owner', e.target.value, `system-owner-${selectedNodeId}`)}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Business Capability</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. Order to Cash"
                  value={selectedSystemData?.businessCapability || ''}
                  onChange={(e) => updateSystemField(selectedNodeId, 'businessCapability', e.target.value, `system-capability-${selectedNodeId}`)}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Tech Stack (comma-separated)</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. Java, PostgreSQL, AWS"
                  value={(selectedSystemData?.techStack || []).join(', ')}
                  onChange={(e) => updateSystemField(
                    selectedNodeId, 'techStack',
                    e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                    `system-stack-${selectedNodeId}`
                  )}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Description</label>
                <textarea
                  className={inputClass}
                  rows={3}
                  placeholder="What does this system do?"
                  value={selectedSystemData?.description || ''}
                  onChange={(e) => updateSystemField(selectedNodeId, 'description', e.target.value, `system-desc-${selectedNodeId}`)}
                />
              </div>

              <div className="border-t pt-4">
                <h3 className="font-bold text-sm mb-2 text-slate-700">Objects in this System</h3>
                {objectsInSelectedSystem.length === 0 ? (
                  <p className="text-xs text-slate-500">No objects associated.</p>
                ) : (
                  <div className="flex flex-col gap-1 max-h-[30vh] overflow-y-auto pr-1">
                    {objectsInSelectedSystem.map(obj => {
                      const alias = obj.aliases?.[selectedNodeId] || '';
                      return (
                        <div key={obj.id} className="text-xs bg-white border px-2 py-1 rounded shadow-sm flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="truncate pr-2 font-bold text-slate-700" title={obj.name}>{obj.name}</span>
                            {obj.masterSystemId === selectedNodeId && (
                              <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded-full font-bold">Master</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <input
                              type="text"
                              className="w-full px-1 py-0.5 border border-slate-300 bg-white shadow-inner rounded text-xs placeholder-slate-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
                              placeholder="Alias in this system..."
                              value={alias}
                              onChange={(e) => setSystemAlias(obj.id, selectedNodeId, e.target.value)}
                            />
                            <button
                              className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded hover:bg-red-200 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteObject(obj.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                className="mt-8 bg-red-500 text-white px-3 py-2 rounded hover:bg-red-600"
                onClick={() => {
                  deleteSystem(selectedNodeId);
                  setSelectedNodeId(null);
                }}
              >
                Delete System
              </button>
            </>
          ) : selectedObject ? (
            <>
              <button className="text-blue-600 text-xs text-left mb-2 hover:underline" onClick={() => setSelectedObjectIdSidebar(null)}>
                &larr; Back to All Objects
              </button>
              <h2 className="font-bold text-lg border-b pb-2">Object Details</h2>

              <div className="mt-2">
                <label className="block text-xs font-bold mb-1">Global Name</label>
                <input
                  type="text"
                  className={inputClass}
                  value={selectedObject.name}
                  onChange={(e) => renameObjectGlobal(selectedObject.id, e.target.value)}
                />
              </div>

              <div className="mt-4">
                <label className="block text-xs font-bold mb-1">Classification</label>
                <select
                  className={inputClass}
                  value={selectedObject.classification || 'internal'}
                  onChange={(e) => updateObjectField(selectedObject.id, 'classification', e.target.value as DataObjectClassification)}
                >
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>

              <div className="mt-4">
                <label className="block text-xs font-bold mb-1">Description</label>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={selectedObject.description || ''}
                  onChange={(e) => updateObjectField(selectedObject.id, 'description', e.target.value, `object-desc-${selectedObject.id}`)}
                />
              </div>

              <div className="mt-4">
                <label className="block text-xs font-bold mb-1">Master System</label>
                <select
                  className={inputClass}
                  value={selectedObject.masterSystemId || ''}
                  onChange={(e) => updateObjectField(selectedObject.id, 'masterSystemId', e.target.value)}
                >
                  <option value="" disabled>-- Select a System --</option>
                  {nodes.filter(isEaSystemNode).map(n => <option key={n.id} value={n.id}>{n.data.label}</option>)}
                </select>
              </div>

              <div className="mt-4 border-t pt-4">
                <h3 className="font-bold text-sm mb-2 text-slate-700">System Aliases</h3>
                {Object.entries(selectedObject.aliases || {}).length === 0 ? (
                  <p className="text-xs text-slate-500">No aliases defined.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {Object.entries(selectedObject.aliases || {}).map(([sysId, alias]) => {
                      const sysName = getSystemLabel(sysId) || 'Unknown System';
                      return (
                        <div key={sysId} className="flex flex-col gap-1 bg-white border p-2 rounded">
                          <span className="text-xs font-bold text-slate-600">{sysName}</span>
                          <input
                            type="text"
                            className="w-full px-1 py-0.5 border border-slate-300 bg-white shadow-inner rounded text-xs focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
                            value={alias}
                            onChange={(e) => setSystemAlias(selectedObject.id, sysId, e.target.value)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                className="mt-8 bg-red-500 text-white px-3 py-2 rounded hover:bg-red-600"
                onClick={() => {
                  deleteObject(selectedObject.id);
                  setSelectedObjectIdSidebar(null);
                }}
              >
                Delete Object
              </button>
            </>
          ) : (
            <>
              <h2 className="font-bold text-lg border-b pb-2">All Data Objects</h2>
              <div className="text-sm text-slate-600 mb-4">
                Manage global data objects.
              </div>
              {dataObjects.length === 0 && <p className="text-sm text-slate-500">No objects added yet.</p>}

              <input
                type="text"
                placeholder="Search objects..."
                className="w-full px-2 py-1 border border-slate-300 bg-white shadow-inner rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none mb-2"
                value={sidebarObjectSearch}
                onChange={e => setSidebarObjectSearch(e.target.value)}
              />

              <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
                {dataObjects
                  .filter(obj => {
                    if (!sidebarObjectSearch) return true;
                    const search = sidebarObjectSearch.toLowerCase();
                    if (obj.name.toLowerCase().includes(search)) return true;
                    return Object.values(obj.aliases || {}).some(alias => alias.toLowerCase().includes(search));
                  })
                  .slice(0, 100) // Render limit for performance
                  .map((obj) => (
                  <div
                    key={obj.id}
                    className="flex flex-col gap-1 bg-white p-2 rounded border shadow-sm cursor-pointer hover:border-blue-400 transition-colors group"
                    onClick={() => setSelectedObjectIdSidebar(obj.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate font-bold text-sm group-hover:text-blue-600 transition-colors">{obj.name}</span>
                      <span className="text-[10px] text-slate-400 shrink-0 group-hover:text-blue-600 transition-colors">Edit &rarr;</span>
                    </div>
                    {obj.masterSystemId && (
                       <span className="text-[10px] text-slate-500 truncate">
                         Master: {getSystemLabel(obj.masterSystemId) || 'Unknown'}
                       </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

        </div>
      </div>
      )}
    </div>
  );
}
