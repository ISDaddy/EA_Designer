import React, { useState, useMemo, useCallback } from 'react';
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
const API_URL = `http://localhost:${BACKEND_PORT}/api/state`;

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

      <div className="font-bold text-[#1f497d] text-center mt-2 whitespace-pre-wrap">{data.label}</div>

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

type SystemNodeData = {
  label: string;
  layoutPositions?: Record<string, { x: number; y: number }>;
  isHighlighted?: boolean;
};

type SystemNode = Node<SystemNodeData, 'eaSystem'> | Node<{}, 'junction'>;
type IntegrationEdgeData = { dataObjectIds: string[] };
type IntegrationEdge = Edge<IntegrationEdgeData>;

type DataObject = {
  id: string;
  name: string;
  masterSystemId: string;
  aliases?: Record<string, string>; // systemId -> alias
};

export default function App() {
  const [nodes, setNodes] = useNodesState<SystemNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<IntegrationEdge>([]);
  const [dataObjects, setDataObjects] = useState<DataObject[]>([]);

  const [newSystemName, setNewSystemName] = useState('');
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectMaster, setNewObjectMaster] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from DB on mount
  React.useEffect(() => {
    fetch(API_URL)
      .then(res => res.json())
      .then(data => {
        if (data.systems) {
          setNodes(data.systems.map((s: any) => ({
            id: s.id,
            type: 'eaSystem',
            position: { x: s.x, y: s.y },
            data: { label: s.label, layoutPositions: s.layout_positions || {} }
          })));
        }
        if (data.dataObjects) {
          setDataObjects(data.dataObjects.map((o: any) => ({
            id: o.id,
            name: o.name,
            masterSystemId: o.master_system_id,
            aliases: o.aliases || {}
          })));
        }
        if (data.edges) {
          setEdges(data.edges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            data: { dataObjectIds: e.data_object_ids },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#b1b1b7' },
            style: { stroke: '#b1b1b7', strokeWidth: 2 },
          })));
        }
      })
      .catch(err => console.error('Failed to load state', err))
      .finally(() => setIsLoaded(true));
  }, [setNodes, setEdges]);

  const saveToDB = useCallback(async () => {
    if (!isLoaded) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systems: nodes.filter(n => n.type !== 'junction'), dataObjects, edges })
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save to DB', err);
    }
    setIsSaving(false);
  }, [isLoaded, nodes, edges, dataObjects]);

  // Auto-save debounce
  React.useEffect(() => {
    if (!isLoaded) return;
    const timeout = setTimeout(() => {
      saveToDB();
    }, 1000);
    return () => clearTimeout(timeout);
  }, [nodes, edges, dataObjects, isLoaded, saveToDB]);

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

  const addSystem = () => {
    if (!newSystemName) return;
    if (nodes.some(n => n.type === 'eaSystem' && (n.data as any).label.toLowerCase() === newSystemName.trim().toLowerCase())) {
      alert('A system with this name already exists.');
      return;
    }
    const position = { x: Math.random() * 400, y: Math.random() * 400 };
    const newNode: SystemNode = {
      id: `sys-${Date.now()}`,
      type: 'eaSystem',
      data: { 
        label: newSystemName.trim(),
        layoutPositions: { 'global': position }
      },
      position,
    };
    setNodes((nds) => [...nds, newNode]);
    setNewSystemName('');
  };

  const addObject = () => {
    if (!newObjectName || !newObjectMaster) {
      alert('Please provide both an object name and a master system.');
      return;
    }
    if (dataObjects.some(o => o.name.toLowerCase() === newObjectName.trim().toLowerCase())) {
      alert('A data object with this name already exists.');
      return;
    }

    const masterName = newObjectMaster.trim();
    let masterNode = nodes.find(n => n.type === 'eaSystem' && (n.data as any).label.toLowerCase() === masterName.toLowerCase());
    
    // Create master system if it doesn't exist
    if (!masterNode) {
      masterNode = {
        id: `sys-${Date.now()}`,
        type: 'eaSystem',
        data: { label: masterName },
        position: { x: Math.random() * 400, y: Math.random() * 400 },
      };
      setNodes((nds) => [...nds, masterNode!]);
    }

    setDataObjects((objs) => [...objs, { 
      id: `obj-${Date.now()}`, 
      name: newObjectName.trim(),
      masterSystemId: masterNode!.id
    }]);
    setNewObjectName('');
    setNewObjectMaster('');
  };

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

    let sPos = Position.Right;
    let tPos = Position.Left;

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

  const confirmPendingEdge = () => {
    if (!pendingEdge) return;
    
    let objectId = '';
    
    // Find or create object
    if (pendingEdgeObject.trim()) {
      const objName = pendingEdgeObject.trim();
      let existingObj = dataObjects.find(o => o.name.toLowerCase() === objName.toLowerCase());
      if (existingObj) {
        objectId = existingObj.id;
      } else {
        objectId = `obj-${Date.now()}`;
        // Set the source of the edge as the master system for the new object
        setDataObjects(objs => [...objs, { id: objectId, name: objName, masterSystemId: pendingEdge.source }]);
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
      data: { dataObjectIds: objectId ? [objectId] : [] },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#b1b1b7' },
      style: { stroke: '#b1b1b7', strokeWidth: 2 },
    };
    
    setEdges((eds) => addEdge(newEdge, eds));
    setPendingEdge(null);
    setPendingEdgeObject('');
    
    // Optionally open the right sidebar for this edge
    setSelectedEdgeId(newEdge.id);
    setSelectedNodeId(null);
  };

  const toggleObjectOnEdge = (edgeId: string, objectId: string) => {
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id === edgeId) {
          const currentIds = e.data?.dataObjectIds || [];
          const newIds = currentIds.includes(objectId)
            ? currentIds.filter((id) => id !== objectId)
            : [...currentIds, objectId];
          return { ...e, data: { ...e.data, dataObjectIds: newIds } };
        }
        return e;
      })
    );
  };

  const deleteSelectedEdge = () => {
    if (selectedEdgeId) {
      setEdges((eds) => eds.filter(e => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  };

  const deleteObject = (objId: string) => {
    const obj = dataObjects.find(o => o.id === objId);
    if (!window.confirm(`Are you sure you want to permanently delete the Data Object "${obj?.name}"? All connections exclusively using this object will also be deleted.`)) {
      return;
    }

    // Remove object
    setDataObjects(objs => objs.filter(o => o.id !== objId));

    // Remove object from edges. If an edge has no objects left, delete the edge entirely.
    setEdges(eds => {
      const updated = eds.map(e => ({
        ...e,
        data: {
          ...e.data,
          dataObjectIds: e.data?.dataObjectIds?.filter(id => id !== objId) || []
        }
      }));
      return updated.filter(e => e.data.dataObjectIds.length > 0);
    });
  };

  const deleteSystem = (sysId: string) => {
    // Remove system node
    setNodes(nds => nds.filter(n => n.id !== sysId));
    // Remove any associated edges
    setEdges(eds => eds.filter(e => e.source !== sysId && e.target !== sysId));
  };

  const renameSystem = (sysId: string, newLabel: string) => {
    setNodes(nds => nds.map(n => {
      if (n.id === sysId && n.type === 'eaSystem') {
        return { ...n, data: { ...n.data, label: newLabel } };
      }
      return n;
    }));
  };

  const renameObjectGlobal = (objId: string, newName: string) => {
    setDataObjects(objs => objs.map(o => {
      if (o.id === objId) return { ...o, name: newName };
      return o;
    }));
  };

  const setSystemAlias = (objId: string, sysId: string, alias: string) => {
    setDataObjects(objs => objs.map(o => {
      if (o.id === objId) {
        return { ...o, aliases: { ...(o.aliases || {}), [sysId]: alias } };
      }
      return o;
    }));
  };

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

  const { processedNodes, processedEdges } = useMemo(() => {
    let finalNodes: Node[] = [...nodes.filter(n => n.type !== 'junction')]; // Base system nodes
    let finalEdges: Edge[] = [];
    const hiddenOriginalEdges = new Set<string>();

    // 1. Apply Junction Pattern if a node is selected
    if (selectedNodeId) {
      const selectedNode = finalNodes.find(n => n.id === selectedNodeId);
      if (selectedNode) {
        const incomingGroups: Record<string, IntegrationEdge[]> = {};
        const outgoingGroups: Record<string, IntegrationEdge[]> = {};

        // Group edges connected to selected node by their local alias
        edges.forEach(e => {
          if (e.target === selectedNodeId) {
            const localLabel = e.data?.dataObjectIds?.map(id => getAlias(id, selectedNodeId)).join(', ') || 'Unknown';
            if (!incomingGroups[localLabel]) incomingGroups[localLabel] = [];
            incomingGroups[localLabel].push(e);
          } else if (e.source === selectedNodeId) {
            const localLabel = e.data?.dataObjectIds?.map(id => getAlias(id, selectedNodeId)).join(', ') || 'Unknown';
            if (!outgoingGroups[localLabel]) outgoingGroups[localLabel] = [];
            outgoingGroups[localLabel].push(e);
          }
        });

        const addJunctions = (groups: Record<string, IntegrationEdge[]>, isIncoming: boolean) => {
          Object.entries(groups).forEach(([localLabel, groupEdges], index) => {
            // Check if we can bypass the junction (1:1 connection and identical labels)
            if (groupEdges.length === 1) {
              const e = groupEdges[0];
              const remoteLabel = e.data?.dataObjectIds?.map(id => getAlias(id, isIncoming ? e.source : e.target)).join(', ') || '';
              if (localLabel === remoteLabel) {
                // Bypass junction creation. It will be drawn as a standard edge.
                return;
              }
            }

            const juncId = `junc-${isIncoming ? 'in' : 'out'}-${localLabel.replace(/\s/g, '-')}-${index}`;
            
            groupEdges.forEach(e => hiddenOriginalEdges.add(e.id));

            // Calculate midpoint for junction
            let sumX = 0, sumY = 0, count = 0;
            if (selectedNode) {
              sumX += selectedNode.position.x + ((selectedNode.measured?.width || 150) / 2);
              sumY += selectedNode.position.y + ((selectedNode.measured?.height || 60) / 2);
              count++;
            }
            groupEdges.forEach(e => {
              const remoteId = isIncoming ? e.source : e.target;
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
              groupEdges.forEach((e, i) => {
                const remoteNode = finalNodes.find(n => n.id === e.source);
                const bestSub = remoteNode ? getClosestHandles(remoteNode, juncNode) : { sourceHandle: undefined, targetHandle: undefined };
                const remoteLabel = e.data?.dataObjectIds?.map(id => getAlias(id, e.source)).join(', ') || '';
                finalEdges.push({
                  ...baseEdgeStyle,
                  id: `${juncId}-sub-${i}`,
                  source: e.source,
                  target: juncId,
                  sourceHandle: bestSub.sourceHandle,
                  targetHandle: bestSub.targetHandle,
                  label: remoteLabel,
                  data: e.data
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
              groupEdges.forEach((e, i) => {
                const remoteNode = finalNodes.find(n => n.id === e.target);
                const bestSub = remoteNode ? getClosestHandles(juncNode, remoteNode) : { sourceHandle: undefined, targetHandle: undefined };
                const remoteLabel = e.data?.dataObjectIds?.map(id => getAlias(id, e.target)).join(', ') || '';
                finalEdges.push({
                  ...baseEdgeStyle,
                  id: `${juncId}-sub-${i}`,
                  source: juncId,
                  target: e.target,
                  sourceHandle: bestSub.sourceHandle,
                  targetHandle: bestSub.targetHandle,
                  label: remoteLabel,
                  data: e.data
                });
              });
            }
          });
        };

        addJunctions(incomingGroups, true);
        addJunctions(outgoingGroups, false);
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
    let allowedObjectIds = new Set<string>();
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
      if (n.type === 'junction') return n;
      
      const contextKey = selectedNodeId || 'global';
      const layoutPositions = (n.data as any).layoutPositions || {};
      
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
          if (change && change.position) {
            const layoutPositions = { ...((n.data as any).layoutPositions || {}) };
            layoutPositions[contextKey] = change.position;
            
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
  }, [selectedNodeId, setNodes]);

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
      {(isSaving || saveSuccess) && (
        <div className="absolute bottom-4 right-4 z-50 bg-slate-800/80 text-white/70 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm pointer-events-none transition-opacity">
          {isSaving ? 'Syncing...' : 'Saved'}
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
            {nodes.filter(n => n.type === 'eaSystem').map(n => <option key={n.id} value={(n.data as any).label}>{(n.data as any).label}</option>)}
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
            {nodes.filter(n => n.type === 'eaSystem').map(n => <option key={n.id} value={n.id}>{(n.data as any).label}</option>)}
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
      </header>

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
              <div className="text-sm text-slate-600 mb-4">
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
              
              <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
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
              <div className="text-sm text-slate-600 mb-4">
                <label className="block text-xs font-bold mb-1">System Name</label>
                  <input 
                  type="text" 
                  className="w-full px-2 py-1 border border-slate-300 bg-white shadow-inner rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
                  value={(nodes.find(n => n.id === selectedNodeId && n.type === 'eaSystem')?.data as any)?.label || ''}
                  onChange={(e) => renameSystem(selectedNodeId, e.target.value)}
                />
              </div>
              <div className="mt-4 border-t pt-4">
                <h3 className="font-bold text-sm mb-2 text-slate-700">Objects in this System</h3>
                {objectsInSelectedSystem.length === 0 ? (
                  <p className="text-xs text-slate-500">No objects associated.</p>
                ) : (
                  <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto pr-1">
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
          ) : selectedObjectIdSidebar && dataObjects.find(o => o.id === selectedObjectIdSidebar) ? (() => {
            const obj = dataObjects.find(o => o.id === selectedObjectIdSidebar)!;
            return (
              <>
                <button className="text-blue-600 text-xs text-left mb-2 hover:underline" onClick={() => setSelectedObjectIdSidebar(null)}>
                  &larr; Back to All Objects
                </button>
                <h2 className="font-bold text-lg border-b pb-2">Object Details</h2>
                
                <div className="mt-2">
                  <label className="block text-xs font-bold mb-1">Global Name</label>
                  <input 
                    type="text" 
                    className="w-full px-2 py-1 border border-slate-300 bg-white shadow-inner rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
                    value={obj.name}
                    onChange={(e) => renameObjectGlobal(obj.id, e.target.value)}
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-bold mb-1">Master System</label>
                  <select 
                    className="w-full px-2 py-1 border border-slate-300 bg-white shadow-inner rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none cursor-pointer"
                    value={obj.masterSystemId || ''}
                    onChange={(e) => {
                      const sysId = e.target.value;
                      setDataObjects(objs => objs.map(o => o.id === obj.id ? { ...o, masterSystemId: sysId } : o));
                    }}
                  >
                    <option value="" disabled>-- Select a System --</option>
                    {nodes.filter(n => n.type === 'eaSystem').map(n => <option key={n.id} value={n.id}>{(n.data as any)?.label}</option>)}
                  </select>
                </div>

                <div className="mt-4 border-t pt-4">
                  <h3 className="font-bold text-sm mb-2 text-slate-700">System Aliases</h3>
                  {Object.entries(obj.aliases || {}).length === 0 ? (
                    <p className="text-xs text-slate-500">No aliases defined.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {Object.entries(obj.aliases || {}).map(([sysId, alias]) => {
                        const sysName = (nodes.find(n => n.id === sysId && n.type === 'eaSystem')?.data as any)?.label || 'Unknown System';
                        return (
                          <div key={sysId} className="flex flex-col gap-1 bg-white border p-2 rounded">
                            <span className="text-xs font-bold text-slate-600">{sysName as string}</span>
                            <input 
                              type="text" 
                              className="w-full px-1 py-0.5 border border-slate-300 bg-white shadow-inner rounded text-xs focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
                              value={alias}
                              onChange={(e) => setSystemAlias(obj.id, sysId, e.target.value)}
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
                    deleteObject(obj.id);
                    setSelectedObjectIdSidebar(null);
                  }}
                >
                  Delete Object
                </button>
              </>
            );
          })() : (
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
                         Master: {(nodes.find(n => n.id === obj.masterSystemId && n.type === 'eaSystem')?.data as any)?.label || 'Unknown'}
                       </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

