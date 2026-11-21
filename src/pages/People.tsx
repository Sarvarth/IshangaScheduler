import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ACTIVE_ASSIGNMENT, fmtDate, ISHANGA_CLUSTERS, todayISO } from '../lib/format';
import type { PersonWithTags } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import PersonForm from '../components/PersonForm';
import PeopleRosterImport from '../components/PeopleRosterImport';
import { Badge, Button, Card, ChipSelect, Empty, Input, PageHeader, Select, Spinner } from '../components/ui';

type Stat = { upcoming: number; total: number; last: string | null };

export default function People() {
  const { can } = useAuth();
  const { typeById, attributeById, ishangaTypes, attributes } = useLookups();
  const nav = useNavigate();
  const [people, setPeople] = useState<PersonWithTags[] | null>(null);
  const [stats, setStats] = useState<Map<string, Stat>>(new Map());
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>(['all']);
  const [attrFilter, setAttrFilter] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clusterFilter, setClusterFilter] = useState('');

  const load = async () => {
    const [p, a] = await Promise.all([
      supabase.from('people').select('*, person_types(type_id), person_attributes(attribute_id)').order('full_name'),
      supabase.from('assignments').select('person_id, status, activities(start_date)').in('status', ACTIVE_ASSIGNMENT),
    ]);
    setPeople((p.data ?? []) as PersonWithTags[]);
    const today = todayISO();
    const m = new Map<string, Stat>();
    for (const r of (a.data ?? []) as unknown as { person_id: string; activities: { start_date: string } | null }[]) {
      const d = r.activities?.start_date;
      if (!d) continue;
      const s = m.get(r.person_id) ?? { upcoming: 0, total: 0, last: null };
      s.total++;
      if (d >= today) s.upcoming++;
      else if (!s.last || d > s.last) s.last = d;
      m.set(r.person_id, s);
    }
    setStats(m);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (people ?? []).filter((p) => {
      if (activeFilter === 'active' && !p.is_active) return false;
      if (activeFilter === 'inactive' && p.is_active) return false;
      if (clusterFilter && p.cluster !== clusterFilter) return false;
      const selectedType = typeFilter.find((typeId) => typeId !== 'all');
      if (selectedType && !p.person_types.some((type) => type.type_id === selectedType)) return false;
      if (selectedType) {
        const selectedName = typeById.get(selectedType)?.name;
        const otherName = selectedName === 'SPS Ishanga' ? 'Satsang Ishanga' : selectedName === 'Satsang Ishanga' ? 'SPS Ishanga' : null;
        if (otherName && p.person_types.some((type) => typeById.get(type.type_id)?.name === otherName)) return false;
      }
      if (attrFilter.length && !attrFilter.every((t) => p.person_attributes.some((x) => x.attribute_id === t))) return false;
      if (term && ![p.full_name, p.city, p.center, p.secondary_center, p.state, p.cluster, p.phone, p.email].some((v) => v?.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [people, q, typeFilter, attrFilter, activeFilter, clusterFilter]);

  const clusters = [...new Set([...(people ?? []).map((p) => p.cluster).filter((value): value is string => !!value), ...ISHANGA_CLUSTERS])].sort();

  return (
    <>
      <PageHeader
        title="Ishangas"
        subtitle={people ? `${filtered.length} of ${people.length}` : undefined}
        actions={can('manage_people') && <><Button variant="secondary" onClick={() => setImporting(true)}>Import CSV</Button><Button onClick={() => setAdding(true)}>+ Add</Button></>}
      />
      <div className="mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_8rem]">
          <Input className="col-span-2 sm:col-span-1" placeholder="Search name, center, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-full" value={clusterFilter} onChange={(e) => setClusterFilter(e.target.value)}>
            <option value="">All clusters</option>
            {clusters.map((cluster) => <option key={cluster} value={cluster}>{cluster}</option>)}
          </Select>
          <Select className="w-full" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        <ChipSelect options={[{ id: 'all', name: 'All types' }, ...ishangaTypes]} value={typeFilter} onChange={setTypeFilter} single />
        {attributes.length > 0 && <ChipSelect options={attributes} value={attrFilter} onChange={setAttrFilter} />}
      </div>

      {!people ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <Empty>No people found.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((p) => {
            const s = stats.get(p.id);
            return (
              <Card key={p.id} onClick={() => nav(`/people/${p.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {p.full_name} {!p.is_active && <Badge c="stone">Inactive</Badge>}
                    </div>
                    <div className="text-xs text-stone-500">{[p.center, p.secondary_center, p.state].filter(Boolean).join(' · ') || p.region}</div>
                  </div>
                  {s && s.upcoming > 0 && <Badge c="emerald">{s.upcoming} upcoming</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.cluster && <Badge c="teal">{p.cluster}</Badge>}
                  {p.person_types.map((t) => (
                    <Badge key={t.type_id} c="orange">
                      {typeById.get(t.type_id)?.name}
                    </Badge>
                  ))}
                  {p.person_types.length === 0 && <Badge c="stone">Volunteer</Badge>}
                  {p.person_attributes.map((a) => (
                    <Badge key={a.attribute_id} c="indigo">
                      {attributeById.get(a.attribute_id)?.name}
                    </Badge>
                  ))}
                </div>
                <div className="mt-2 text-xs text-stone-500">
                  {s ? `${s.total} activities` : 'No activities yet'}
                  {s?.last && ` · last ${fmtDate(s.last)}`}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {adding && <PersonForm open onClose={() => setAdding(false)} onSaved={(id) => nav(`/people/${id}`)} />}
      {importing && <PeopleRosterImport open onClose={() => setImporting(false)} onImported={load} />}
    </>
  );
}
