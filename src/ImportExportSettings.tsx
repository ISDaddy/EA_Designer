import { useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Lock, Upload } from 'lucide-react';
import { apiFetch, parseJsonOrError } from './api';
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, labelClass, cardClass } from './ui';
import { useI18n } from './i18n/useI18n';

// The minimal shape this page needs from each entity - deliberately not the full App.tsx types
// (SystemNode/DataObject/IntegrationEdge), so this file has no dependency on the file that renders
// it (SettingsView, in turn rendered by App.tsx) and can't create an import cycle.
export type ExportSystem = { id: string; label: string; businessCapabilityName?: string };
export type ExportObject = { id: string; name: string; masterSystemId: string };
export type ExportEdge = { id: string; source: string; target: string; description?: string; objectIds: string[] };

type SummaryRecord = Record<string, string>;
type NewRow = { id: string; summary: SummaryRecord };
type ConflictRow = { id: string; incoming: SummaryRecord; existing: SummaryRecord; identical: boolean };
type EntityDiff = { new: NewRow[]; conflicts: ConflictRow[] };
type PreviewResponse = { systems: EntityDiff; dataObjects: EntityDiff; edges: EntityDiff };
type EntityKind = 'systems' | 'dataObjects' | 'edges';
type ConflictAction = 'override' | 'skip' | 'rename';
type Resolution = { action: ConflictAction; newLabel?: string };
type ResolutionState = Record<EntityKind, Record<string, Resolution>>;
type CommitCounts = { systems: number; dataObjects: number; edges: number };

// Just enough of the raw exported bundle's shape (snake_case, straight from the DB - see
// POST /api/export) to compute which "new" rows are dependencies of other included rows, for the
// same locked-checkbox treatment the Export picker gives its own dependency closure.
type ImportBundle = {
  systems?: { id: string }[];
  dataObjects?: { id: string; master_system_id?: string | null }[];
  edges?: { id: string; source: string; target: string; data_object_ids?: string[] }[];
};

const EMPTY_RESOLUTIONS: ResolutionState = { systems: {}, dataObjects: {}, edges: {} };

// A single readable line per side of a conflict, rather than a full field-by-field grid - keeps
// the table usable at Settings-page width regardless of which entity kind it's showing.
function formatSummary(kind: EntityKind, s: SummaryRecord): string {
  if (kind === 'systems') return [s.label, s.status, s.criticality, s.businessCapability].filter(Boolean).join(' · ');
  if (kind === 'dataObjects') return [s.name, s.masterSystem, s.classification].filter(Boolean).join(' · ');
  return [`${s.source} → ${s.target}`, s.objects].filter(Boolean).join(' · ');
}

function nameOf(kind: EntityKind, s: SummaryRecord): string {
  if (kind === 'systems') return s.label;
  if (kind === 'dataObjects') return s.name;
  return `${s.source} → ${s.target}`;
}

// A labeled multi-select checklist with its own search box - the same shape is reused for the
// Systems/Data Objects/Edges pickers in the Export section, since all three are just "search a
// list, tick some rows." `lockedIds` follows the same convention used everywhere a dependency
// manager forces in a requirement (a Visual Studio Installer workload, a VS Code extension pack,
// an `apt`/`npm` dependency pull-in): shown ticked and disabled, with a small lock icon, because
// something else already selected requires it - the only way to remove it is to first deselect
// whatever depends on it, not to touch its own checkbox.
function CheckList<T extends { id: string }>({
  items, selected, onToggle, onSetAll, renderLabel, searchPlaceholder, emptyLabel, lockedIds, lockedHint,
}: {
  items: T[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSetAll: (ids: string[], value: boolean) => void;
  renderLabel: (item: T) => string;
  searchPlaceholder: string;
  emptyLabel: string;
  lockedIds?: Set<string>;
  lockedHint?: string;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(item => renderLabel(item).toLowerCase().includes(q));
  }, [items, search, renderLabel]);
  const visibleIds = filtered.map(i => i.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  return (
    <div className="flex flex-col gap-1.5">
      <input className={`${inputClass} text-sm`} placeholder={searchPlaceholder} value={search} onChange={e => setSearch(e.target.value)} />
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--text-secondary)' }}>{t('importExport.export.selectedCount', { count: selected.size })}</span>
        <div className="flex gap-2">
          <button type="button" className="font-medium hover:underline" style={{ color: 'var(--primary)' }} onClick={() => onSetAll(visibleIds, !allVisibleSelected)}>
            {allVisibleSelected ? t('importExport.export.clear') : t('importExport.export.selectAll')}
          </button>
        </div>
      </div>
      <div className="h-44 overflow-y-auto rounded-[var(--radius-input)] border" style={{ borderColor: 'var(--border-subtle)' }}>
        {filtered.length === 0 && (
          <div className="px-2.5 py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</div>
        )}
        {filtered.map(item => {
          const isLocked = !!lockedIds?.has(item.id);
          const checked = selected.has(item.id) || isLocked;
          return (
            <label
              key={item.id}
              className="flex items-center gap-2 px-2.5 py-1.5 text-sm border-b last:border-b-0"
              style={{ borderColor: 'var(--border-subtle)', color: isLocked ? 'var(--text-muted)' : 'var(--text-primary)', cursor: isLocked ? 'default' : 'pointer' }}
              title={isLocked ? lockedHint : undefined}
            >
              <input type="checkbox" checked={checked} disabled={isLocked} onChange={() => { if (!isLocked) onToggle(item.id); }} />
              <span className="truncate">{renderLabel(item)}</span>
              {isLocked && <Lock size={11} className="shrink-0" style={{ color: 'var(--text-muted)' }} />}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

// The Export panel: pick systems/objects/edges to include, then download the resulting bundle as
// a JSON file. Dependencies (an edge's endpoints/objects, an object's master system) are pulled in
// automatically server-side, so a selection never produces a file that can't be imported on its
// own elsewhere.
function ExportPanel({ systems, dataObjects, edges, getSystemLabel }: {
  systems: ExportSystem[];
  dataObjects: ExportObject[];
  edges: ExportEdge[];
  getSystemLabel: (id: string | null | undefined) => string | undefined;
}) {
  const { t } = useI18n();
  const [selectedSystems, setSelectedSystems] = useState<Set<string>>(new Set());
  const [selectedObjects, setSelectedObjects] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const setAll = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (ids: string[], value: boolean) => {
    setter(prev => {
      const next = new Set(prev);
      ids.forEach(id => { if (value) next.add(id); else next.delete(id); });
      return next;
    });
  };

  // Mirrors the server's own dependency closure (resolveExportClosure in server/index.js) so the
  // picker shows, live, exactly what a selection will actually pull in - a selected edge locks in
  // its two systems and the objects it carries, and a selected (or edge-carried) object locks in
  // its master system - rather than that only becoming visible after the file is downloaded.
  const { lockedSystems, lockedObjects } = useMemo(() => {
    const effObjects = new Set(selectedObjects);
    selectedEdges.forEach(edgeId => {
      edges.find(e => e.id === edgeId)?.objectIds.forEach(id => effObjects.add(id));
    });
    const effSystems = new Set(selectedSystems);
    selectedEdges.forEach(edgeId => {
      const edge = edges.find(e => e.id === edgeId);
      if (edge) { effSystems.add(edge.source); effSystems.add(edge.target); }
    });
    effObjects.forEach(objId => {
      const master = dataObjects.find(o => o.id === objId)?.masterSystemId;
      if (master) effSystems.add(master);
    });

    const lockedSystems = new Set([...effSystems].filter(id => !selectedSystems.has(id)));
    const lockedObjects = new Set([...effObjects].filter(id => !selectedObjects.has(id)));
    return { lockedSystems, lockedObjects };
  }, [selectedSystems, selectedObjects, selectedEdges, edges, dataObjects]);

  const edgeLabel = (e: ExportEdge) => `${getSystemLabel(e.source) || e.source} → ${getSystemLabel(e.target) || e.target}`;
  const hasSelection = selectedSystems.size > 0 || selectedObjects.size > 0 || selectedEdges.size > 0;

  const handleExport = async () => {
    setError('');
    setExporting(true);
    try {
      const res = await apiFetch('/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemIds: [...selectedSystems],
          dataObjectIds: [...selectedObjects],
          edgeIds: [...selectedEdges],
        }),
      });
      const data = await parseJsonOrError(res);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `ea-designer-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={`${cardClass} p-5 flex flex-col gap-4`}>
      <div>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('importExport.export.title')}</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('importExport.export.blurb')}</p>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>{t('importExport.section.systems')}</label>
          <CheckList
            items={systems}
            selected={selectedSystems}
            onToggle={(id) => setSelectedSystems(prev => toggleInSet(prev, id))}
            onSetAll={setAll(setSelectedSystems)}
            renderLabel={(s) => s.label}
            searchPlaceholder={t('importExport.export.searchPlaceholder')}
            emptyLabel={t('common.noEntriesYet')}
            lockedIds={lockedSystems}
            lockedHint={t('importExport.lockedHint')}
          />
        </div>
        <div>
          <label className={labelClass}>{t('importExport.section.objects')}</label>
          <CheckList
            items={dataObjects}
            selected={selectedObjects}
            onToggle={(id) => setSelectedObjects(prev => toggleInSet(prev, id))}
            onSetAll={setAll(setSelectedObjects)}
            renderLabel={(o) => o.name}
            searchPlaceholder={t('importExport.export.searchPlaceholder')}
            emptyLabel={t('common.noEntriesYet')}
            lockedIds={lockedObjects}
            lockedHint={t('importExport.lockedHint')}
          />
        </div>
        <div>
          <label className={labelClass}>{t('importExport.section.edges')}</label>
          <CheckList
            items={edges}
            selected={selectedEdges}
            onToggle={(id) => setSelectedEdges(prev => toggleInSet(prev, id))}
            onSetAll={setAll(setSelectedEdges)}
            renderLabel={edgeLabel}
            searchPlaceholder={t('importExport.export.searchPlaceholder')}
            emptyLabel={t('common.noEntriesYet')}
          />
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('importExport.export.dependencyNote')}</p>

      <div>
        <button className={buttonPrimaryClass} disabled={!hasSelection || exporting} onClick={handleExport}>
          <Download size={14} />{exporting ? t('common.loading') : t('importExport.export.button')}
        </button>
      </div>
    </section>
  );
}

// The "new" half of one entity kind's preview: every row that doesn't collide with anything, shown
// with its own checkbox (checked by default) rather than being imported silently - a person can
// still exclude any of them without it needing to conflict with something first. `lockedIds` uses
// the exact same locked-checkbox convention as the Export picker's CheckList: a new row that a
// still-included new edge/object depends on is shown ticked and disabled with a lock icon, since
// excluding it while keeping its dependent would otherwise fail at commit with a foreign-key error.
function NewItemsTable({ kind, rows, resolutions, onToggle, onBulkSet, lockedIds, lockedHint }: {
  kind: EntityKind;
  rows: NewRow[];
  resolutions: Record<string, Resolution>;
  onToggle: (kind: EntityKind, id: string, include: boolean) => void;
  onBulkSet: (kind: EntityKind, include: boolean) => void;
  lockedIds: Set<string>;
  lockedHint: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h5 className="text-xs font-semibold" style={{ color: 'var(--success)' }}>
          {t('importExport.import.newSectionHeader', { count: rows.length })}
        </h5>
        <div className="flex items-center gap-1.5 text-xs">
          <button className={buttonSecondaryClass} style={{ padding: '2px 8px' }} onClick={() => onBulkSet(kind, true)}>{t('importExport.import.includeAll')}</button>
          <button className={buttonSecondaryClass} style={{ padding: '2px 8px' }} onClick={() => onBulkSet(kind, false)}>{t('importExport.import.skipAll')}</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs">
          <thead className="text-left uppercase" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
            <tr>
              <th className="px-2.5 py-1.5 w-16">{t('importExport.import.includeColumn')}</th>
              <th className="px-2.5 py-1.5">{t('importExport.import.itemColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isLocked = lockedIds.has(row.id);
              const included = isLocked || resolutions[row.id]?.action !== 'skip';
              return (
                <tr key={row.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }} title={isLocked ? lockedHint : undefined}>
                  <td className="px-2.5 py-2">
                    <input type="checkbox" checked={included} disabled={isLocked} onChange={(e) => { if (!isLocked) onToggle(kind, row.id, e.target.checked); }} />
                  </td>
                  <td className="px-2.5 py-2 flex items-center gap-1.5" style={{ color: included && !isLocked ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {formatSummary(kind, row.summary)}
                    {isLocked && <Lock size={11} className="shrink-0" style={{ color: 'var(--text-muted)' }} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The "conflict" half of one entity kind's preview: a bulk action row (apply one decision to
// every conflict at once) plus a per-row override, so resolving twenty identical conflicts the
// same way doesn't mean twenty individual clicks.
function ConflictsTable({ kind, rows, resolutions, onBulkSet, onRowAction, onRowLabel }: {
  kind: EntityKind;
  rows: ConflictRow[];
  resolutions: Record<string, Resolution>;
  onBulkSet: (kind: EntityKind, action: ConflictAction) => void;
  onRowAction: (kind: EntityKind, id: string, action: ConflictAction) => void;
  onRowLabel: (kind: EntityKind, id: string, newLabel: string) => void;
}) {
  const { t } = useI18n();
  const canRename = kind !== 'edges';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h5 className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
          {t('importExport.import.conflictsSectionHeader', { count: rows.length })}
        </h5>
        <div className="flex items-center gap-1.5 text-xs">
          <span style={{ color: 'var(--text-secondary)' }}>{t('importExport.import.bulkLabel')}</span>
          <button className={buttonSecondaryClass} style={{ padding: '2px 8px' }} onClick={() => onBulkSet(kind, 'skip')}>{t('importExport.import.actionSkip')}</button>
          <button className={buttonSecondaryClass} style={{ padding: '2px 8px' }} onClick={() => onBulkSet(kind, 'override')}>{t('importExport.import.actionOverride')}</button>
          {canRename && <button className={buttonSecondaryClass} style={{ padding: '2px 8px' }} onClick={() => onBulkSet(kind, 'rename')}>{t('importExport.import.actionRename')}</button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs">
          <thead className="text-left uppercase" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
            <tr>
              <th className="px-2.5 py-1.5">{t('importExport.import.existingColumn')}</th>
              <th className="px-2.5 py-1.5">{t('importExport.import.incomingColumn')}</th>
              <th className="px-2.5 py-1.5 w-56">{t('importExport.import.actionColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const resolution = resolutions[row.id];
              return (
                <tr key={row.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2.5 py-2" style={{ color: 'var(--text-primary)' }}>
                    {formatSummary(kind, row.existing)}
                    {row.identical && (
                      <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
                        {t('importExport.import.identicalBadge')}
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-2" style={{ color: 'var(--text-primary)' }}>{formatSummary(kind, row.incoming)}</td>
                  <td className="px-2.5 py-2">
                    <select
                      className={`${inputClass} text-xs py-1`}
                      value={resolution?.action || ''}
                      onChange={(e) => onRowAction(kind, row.id, e.target.value as ConflictAction)}
                    >
                      <option value="" disabled>{t('importExport.import.chooseAction')}</option>
                      <option value="skip">{t('importExport.import.actionSkip')}</option>
                      <option value="override">{t('importExport.import.actionOverride')}</option>
                      {canRename && <option value="rename">{t('importExport.import.actionRename')}</option>}
                    </select>
                    {canRename && resolution?.action === 'rename' && (
                      <input
                        className={`${inputClass} text-xs py-1 mt-1`}
                        placeholder={t('importExport.import.newLabelPlaceholder')}
                        value={resolution.newLabel || ''}
                        onChange={(e) => onRowLabel(kind, row.id, e.target.value)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One entity kind's full preview: its "new" rows (each individually includable/skippable) above
// its conflicting rows (each needing an explicit resolution). Renders nothing for a kind the
// bundle simply has none of, rather than an empty "Systems" section with nothing under it.
function EntitySection({ kind, title, diff, resolutions, onBulkSetConflicts, onRowAction, onRowLabel, onToggleNew, onBulkSetNew, lockedNewIds, lockedHint }: {
  kind: EntityKind;
  title: string;
  diff: EntityDiff;
  resolutions: Record<string, Resolution>;
  onBulkSetConflicts: (kind: EntityKind, action: ConflictAction) => void;
  onRowAction: (kind: EntityKind, id: string, action: ConflictAction) => void;
  onRowLabel: (kind: EntityKind, id: string, newLabel: string) => void;
  onToggleNew: (kind: EntityKind, id: string, include: boolean) => void;
  onBulkSetNew: (kind: EntityKind, include: boolean) => void;
  lockedNewIds: Set<string>;
  lockedHint: string;
}) {
  if (diff.new.length === 0 && diff.conflicts.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h4>
      {diff.new.length > 0 && (
        <NewItemsTable kind={kind} rows={diff.new} resolutions={resolutions} onToggle={onToggleNew} onBulkSet={onBulkSetNew} lockedIds={lockedNewIds} lockedHint={lockedHint} />
      )}
      {diff.conflicts.length > 0 && (
        <ConflictsTable kind={kind} rows={diff.conflicts} resolutions={resolutions} onBulkSet={onBulkSetConflicts} onRowAction={onRowAction} onRowLabel={onRowLabel} />
      )}
    </div>
  );
}

function defaultRenameLabel(kind: EntityKind, row: ConflictRow): string {
  const base = nameOf(kind, row.incoming);
  return base ? `${base} (imported)` : '';
}

// The Import panel: pick a previously exported bundle, review exactly what's new vs. what
// collides with something already here, resolve every collision (individually or in bulk), and
// only then commit. Nothing is written until "Start Import" is clicked.
function ImportPanel({ reloadState }: { reloadState: () => Promise<void> }) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [bundle, setBundle] = useState<ImportBundle | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [resolutions, setResolutions] = useState<ResolutionState>(EMPTY_RESOLUTIONS);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: CommitCounts; updated: CommitCounts; skipped: CommitCounts } | null>(null);

  const reset = () => {
    setFileName(''); setBundle(null); setPreview(null); setResolutions(EMPTY_RESOLUTIONS); setError(''); setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    reset();
    setFileName(file.name);
    setLoading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ImportBundle;
      setBundle(parsed);
      const res = await apiFetch('/import/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bundle: parsed }),
      });
      const data = (await parseJsonOrError(res)) as PreviewResponse;
      setPreview(data);
      // Conflicts that are byte-for-byte identical to what's already here are pre-resolved to
      // "skip" (importing them would be a no-op either way) so the person only has to make a real
      // decision where the incoming data actually differs; every other conflict starts unresolved.
      const seed = (diff: EntityDiff): Record<string, Resolution> => {
        const map: Record<string, Resolution> = {};
        diff.conflicts.forEach(c => { if (c.identical) map[c.id] = { action: 'skip' }; });
        return map;
      };
      setResolutions({ systems: seed(data.systems), dataObjects: seed(data.dataObjects), edges: seed(data.edges) });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('importExport.import.invalidFile'));
    } finally {
      setLoading(false);
    }
  };

  const bulkSetConflicts = (kind: EntityKind, action: ConflictAction) => {
    if (!preview) return;
    setResolutions(prev => {
      const next = { ...prev[kind] };
      preview[kind].conflicts.forEach(row => {
        next[row.id] = action === 'rename' ? { action, newLabel: prev[kind][row.id]?.newLabel || defaultRenameLabel(kind, row) } : { action };
      });
      return { ...prev, [kind]: next };
    });
  };

  // Which "new" systems/objects a still-included row elsewhere in the bundle depends on - the
  // Import-side equivalent of the Export picker's own dependency closure (see ExportPanel above).
  // A "new" row that's skipped simply doesn't get created, so anything that still references it
  // (an included new edge, or an included object's master system) needs it locked in too, or the
  // commit fails with a foreign-key error. A conflict row never needs this: overriding, renaming,
  // or skipping it all leave a valid, already-existing id in place - only a skipped *new* row can
  // vanish out from under something that still points at it.
  const { lockedSystems, lockedObjects } = useMemo(() => {
    const lockedSystems = new Set<string>();
    const lockedObjects = new Set<string>();
    if (!bundle || !preview) return { lockedSystems, lockedObjects };
    const newSystemIds = new Set(preview.systems.new.map(r => r.id));
    const newObjectIds = new Set(preview.dataObjects.new.map(r => r.id));
    const isSkipped = (kind: EntityKind, id: string) => resolutions[kind][id]?.action === 'skip';

    (bundle.edges || []).forEach(edge => {
      if (isSkipped('edges', edge.id)) return;
      if (newSystemIds.has(edge.source)) lockedSystems.add(edge.source);
      if (newSystemIds.has(edge.target)) lockedSystems.add(edge.target);
      (edge.data_object_ids || []).forEach(objId => { if (newObjectIds.has(objId)) lockedObjects.add(objId); });
    });
    (bundle.dataObjects || []).forEach(obj => {
      if (isSkipped('dataObjects', obj.id)) return;
      if (obj.master_system_id && newSystemIds.has(obj.master_system_id)) lockedSystems.add(obj.master_system_id);
    });

    return { lockedSystems, lockedObjects };
  }, [bundle, preview, resolutions]);

  const lockedNewIdsFor = (kind: EntityKind): Set<string> =>
    kind === 'systems' ? lockedSystems : kind === 'dataObjects' ? lockedObjects : new Set<string>();

  // A "new" row has no conflict to resolve - the only thing to track is whether it's still
  // included (the default) or has been explicitly excluded, which is just the 'skip' action
  // reused on a row that was never a conflict in the first place. A locked row (see above) can't
  // be toggled at all - it's required by something still included, the same way a locked Export
  // checkbox can't be individually unticked.
  const toggleNew = (kind: EntityKind, id: string, include: boolean) => {
    if (lockedNewIdsFor(kind).has(id)) return;
    setResolutions(prev => {
      const next = { ...prev[kind] };
      if (include) delete next[id]; else next[id] = { action: 'skip' };
      return { ...prev, [kind]: next };
    });
  };

  const bulkSetNew = (kind: EntityKind, include: boolean) => {
    if (!preview) return;
    const locked = lockedNewIdsFor(kind);
    setResolutions(prev => {
      const next = { ...prev[kind] };
      preview[kind].new.forEach(row => {
        if (locked.has(row.id)) return;
        if (include) delete next[row.id]; else next[row.id] = { action: 'skip' };
      });
      return { ...prev, [kind]: next };
    });
  };

  const rowAction = (kind: EntityKind, id: string, action: ConflictAction) => {
    const row = preview?.[kind].conflicts.find(r => r.id === id);
    setResolutions(prev => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        [id]: action === 'rename' ? { action, newLabel: prev[kind][id]?.newLabel || (row ? defaultRenameLabel(kind, row) : '') } : { action },
      },
    }));
  };

  const rowLabel = (kind: EntityKind, id: string, newLabel: string) => {
    setResolutions(prev => ({ ...prev, [kind]: { ...prev[kind], [id]: { action: 'rename', newLabel } } }));
  };

  const allResolved = useMemo(() => {
    if (!preview) return false;
    return (['systems', 'dataObjects', 'edges'] as EntityKind[]).every(kind =>
      preview[kind].conflicts.every(row => {
        const r = resolutions[kind][row.id];
        return !!r?.action && (r.action !== 'rename' || !!r.newLabel?.trim());
      })
    );
  }, [preview, resolutions]);

  const totalConflicts = preview ? preview.systems.conflicts.length + preview.dataObjects.conflicts.length + preview.edges.conflicts.length : 0;
  const totalNew = preview ? preview.systems.new.length + preview.dataObjects.new.length + preview.edges.new.length : 0;

  const handleCommit = async () => {
    if (!bundle) return;
    setCommitting(true);
    setError('');
    try {
      // A row can carry a stale 'skip' resolution from before it became locked (e.g. it was
      // individually skipped, then something else that depends on it got re-included) - the
      // checkbox already shows it as locked-and-included regardless of that leftover entry, but
      // the payload itself must agree, or the server would skip a dependency the UI promised was
      // included. Locked ids always win over whatever resolution they're still carrying.
      const sanitizedResolutions: ResolutionState = {
        systems: { ...resolutions.systems },
        dataObjects: { ...resolutions.dataObjects },
        edges: { ...resolutions.edges },
      };
      lockedSystems.forEach(id => delete sanitizedResolutions.systems[id]);
      lockedObjects.forEach(id => delete sanitizedResolutions.dataObjects[id]);

      const res = await apiFetch('/import/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bundle, resolutions: sanitizedResolutions }),
      });
      const data = (await parseJsonOrError(res)) as { created: CommitCounts; updated: CommitCounts; skipped: CommitCounts };
      setResult(data);
      setPreview(null);
      setBundle(null);
      await reloadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <section className={`${cardClass} p-5 flex flex-col gap-4`}>
      <div>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('importExport.import.title')}</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('importExport.import.blurb')}</p>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {result ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--success)' }}>
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">{t('importExport.import.resultTitle')}</p>
              <p style={{ color: 'var(--text-secondary)' }}>
                {t('importExport.import.resultLine', {
                  created: result.created.systems + result.created.dataObjects + result.created.edges,
                  updated: result.updated.systems + result.updated.dataObjects + result.updated.edges,
                  skipped: result.skipped.systems + result.skipped.dataObjects + result.skipped.edges,
                })}
              </p>
            </div>
          </div>
          <div><button className={buttonSecondaryClass} onClick={reset}>{t('importExport.import.chooseAnother')}</button></div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              id="import-export-file-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <label htmlFor="import-export-file-input" className={`${buttonSecondaryClass} cursor-pointer`}>
              <Upload size={14} />{t('importExport.import.chooseFile')}
            </label>
            {fileName && <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{fileName}</span>}
            {loading && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('importExport.import.previewing')}</span>}
          </div>

          {preview && (
            <div className="flex flex-col gap-5">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('importExport.import.summaryLine', { newCount: totalNew, conflictCount: totalConflicts })}
              </p>

              <EntitySection kind="systems" title={t('importExport.section.systems')} diff={preview.systems} resolutions={resolutions.systems} onBulkSetConflicts={bulkSetConflicts} onRowAction={rowAction} onRowLabel={rowLabel} onToggleNew={toggleNew} onBulkSetNew={bulkSetNew} lockedNewIds={lockedSystems} lockedHint={t('importExport.lockedHint')} />
              <EntitySection kind="dataObjects" title={t('importExport.section.objects')} diff={preview.dataObjects} resolutions={resolutions.dataObjects} onBulkSetConflicts={bulkSetConflicts} onRowAction={rowAction} onRowLabel={rowLabel} onToggleNew={toggleNew} onBulkSetNew={bulkSetNew} lockedNewIds={lockedObjects} lockedHint={t('importExport.lockedHint')} />
              <EntitySection kind="edges" title={t('importExport.section.edges')} diff={preview.edges} resolutions={resolutions.edges} onBulkSetConflicts={bulkSetConflicts} onRowAction={rowAction} onRowLabel={rowLabel} onToggleNew={toggleNew} onBulkSetNew={bulkSetNew} lockedNewIds={new Set()} lockedHint={t('importExport.lockedHint')} />

              {!allResolved && totalConflicts > 0 && (
                <p className="text-xs" style={{ color: 'var(--warning)' }}>{t('importExport.import.resolveAllFirst')}</p>
              )}

              <div>
                <button className={buttonPrimaryClass} disabled={!allResolved || committing} onClick={handleCommit}>
                  {committing ? t('importExport.import.committing') : t('importExport.import.commitButton')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ImportExportSettings({ systems, dataObjects, edges, getSystemLabel, reloadState }: {
  systems: ExportSystem[];
  dataObjects: ExportObject[];
  edges: ExportEdge[];
  getSystemLabel: (id: string | null | undefined) => string | undefined;
  reloadState: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ExportPanel systems={systems} dataObjects={dataObjects} edges={edges} getSystemLabel={getSystemLabel} />
      <ImportPanel reloadState={reloadState} />
    </div>
  );
}
