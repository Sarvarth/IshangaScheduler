import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errMsg } from '../lib/format';
import type { Person } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useLookups } from '../context/LookupContext';
import CandidatesTab from '../components/interviews/Candidates';
import MyAvailability from '../components/interviews/MyAvailability';
import MyInterviews from '../components/interviews/MyInterviews';
import { Button, Card, Empty, Field, Input, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui';

type Tab = 'mine' | 'availability' | 'candidates' | 'settings';

export default function Interviews() {
  const { can, profile } = useAuth();
  const manage = can('manage_activities');
  const me = profile?.person_id ?? null;
  const tabs = (
    [
      { id: 'candidates', label: 'Candidates', show: manage },
      { id: 'mine', label: 'My interviews', show: !!me },
      { id: 'availability', label: manage ? 'Availability' : 'My availability', show: !!me || manage },
      { id: 'settings', label: 'Guidelines', show: manage || can('manage_settings') },
    ] as { id: Tab; label: string; show: boolean }[]
  ).filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'mine');

  if (!tabs.length) return <Empty>Ask an admin to link your login to your Ishanga profile to take part in interviews.</Empty>;

  return (
    <>
      <PageHeader title="Interviews" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'candidates' && <CandidatesTab />}
      {tab === 'mine' && me && <MyInterviews personId={me} />}
      {tab === 'availability' && <AvailabilityTab me={me} manage={manage} />}
      {tab === 'settings' && <InterviewSettings />}
    </>
  );
}

function AvailabilityTab({ me, manage }: { me: string | null; manage: boolean }) {
  const L = useLookups();
  const [people, setPeople] = useState<(Pick<Person, 'id' | 'full_name'> & { person_types: { type_id: string }[] })[]>([]);
  const [who, setWho] = useState(me ?? '');

  useEffect(() => {
    if (!manage) return;
    supabase
      .from('people')
      .select('id, full_name, person_types(type_id)')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        const list = (data ?? []) as typeof people;
        setPeople(list.filter((p) => !L.interviewRoleId || L.isEligible(p.person_types.map((t) => t.type_id), L.interviewRoleId)));
        if (!who && list[0]) setWho(list[0].id);
      });
  }, [manage, L]);

  return (
    <>
      {manage && (
        <Field label="Fill availability for" hint="Coordinators can enter times on behalf of Ishangas who share them by phone or WhatsApp.">
          <Select className="mb-4" value={who} onChange={(e) => setWho(e.target.value)}>
            {me && <option value={me}>Myself</option>}
            {people
              .filter((p) => p.id !== me)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
          </Select>
        </Field>
      )}
      {who ? <MyAvailability key={who} personId={who} personName={who !== me ? people.find((p) => p.id === who)?.full_name : undefined} /> : <Empty>Select a person.</Empty>}
    </>
  );
}

function InterviewSettings() {
  const L = useLookups();
  const toast = useToast();
  const [g, setG] = useState(L.settings.interview_guidelines ?? '');
  const [notice, setNotice] = useState(L.settings.min_notice_hours ?? '12');
  const [langs, setLangs] = useState(L.settings.languages ?? '');

  const save = async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('app_settings').upsert([
      { key: 'interview_guidelines', value: g, updated_at: now },
      { key: 'min_notice_hours', value: String(Math.max(0, Number(notice) || 0)), updated_at: now },
      { key: 'languages', value: langs, updated_at: now },
    ]);
    if (error) return toast(errMsg(error), true);
    toast('Saved');
    L.reload();
  };

  return (
    <Card className="space-y-4">
      <Field label="Guidelines shown to candidates" hint="Shown on the booking page. Candidates must tick “I have read” before choosing a time.">
        <Textarea rows={8} value={g} onChange={(e) => setG(e.target.value)} />
      </Field>
      <Field label="Minimum notice (hours)" hint="Candidates can't book a slot starting sooner than this.">
        <Input type="number" min={0} value={notice} onChange={(e) => setNotice(e.target.value)} />
      </Field>
      <Field label="Interview languages (comma separated)">
        <Input value={langs} onChange={(e) => setLangs(e.target.value)} />
      </Field>
      <Button onClick={save}>Save</Button>
    </Card>
  );
}
