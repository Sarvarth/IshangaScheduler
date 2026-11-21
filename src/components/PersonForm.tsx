import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { errMsg, ISHANGA_CLUSTERS } from '../lib/format';
import type { PersonWithTags } from '../lib/types';
import { useLookups } from '../context/LookupContext';
import { Button, Checkbox, ChipSelect, Field, Input, Modal, Textarea, useToast } from './ui';

export default function PersonForm({
  open,
  onClose,
  person,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  person?: PersonWithTags | null;
  onSaved: (id: string) => void;
}) {
  const { ishangaTypes, attributes, languages } = useLookups();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({
    full_name: person?.full_name ?? '',
    phone: person?.phone ?? '',
    email: person?.email ?? '',
    foundation_email: person?.foundation_email ?? '',
    personal_email: person?.personal_email ?? '',
    city: person?.city ?? '',
    state: person?.state ?? '',
    center: person?.center ?? '',
    secondary_center: person?.secondary_center ?? '',
    cluster: person?.cluster ?? '',
    batch: person?.batch ?? '',
    gender: person?.gender ?? '',
    area_of_expertise: person?.area_of_expertise ?? '',
    region: 'North Region',
    is_active: person?.is_active ?? true,
    notes: person?.notes ?? '',
    meet_link: person?.meet_link ?? '',
  }));
  const [types, setTypes] = useState<string[]>(() => {
    const selected = ishangaTypes.find((type) => ['SPS Ishanga', 'Satsang Ishanga'].includes(type.name) && person?.person_types.some((personType) => personType.type_id === type.id));
    return selected ? [selected.id] : [];
  });
  const [attrs, setAttrs] = useState<string[]>(person?.person_attributes.map((a) => a.attribute_id) ?? []);
  const [langs, setLangs] = useState<string[]>(person?.languages ?? []);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.full_name.trim()) return toast('Name is required', true);
    if (f.meet_link.trim() && !/^https:\/\//i.test(f.meet_link.trim())) return toast('Google Meet link must start with https://', true);
    setBusy(true);
    try {
      const row = {
        ...f,
        region: 'North Region',
        meet_link: f.meet_link.trim() || null,
        languages: langs,
        full_name: f.full_name.trim(),
        phone: f.phone || null,
        email: f.email || f.foundation_email || f.personal_email || null,
        foundation_email: f.foundation_email || null,
        personal_email: f.personal_email || null,
        city: f.city || null,
        state: f.state || null,
        center: f.center || null,
        secondary_center: f.secondary_center || null,
        cluster: f.cluster || null,
        batch: f.batch || null,
        gender: f.gender || null,
        area_of_expertise: f.area_of_expertise || null,
        notes: f.notes || null,
      };
      let id = person?.id;
      if (id) {
        const { error } = await supabase.from('people').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('people').insert(row).select('id').single();
        if (error) throw error;
        id = data.id as string;
      }
      // Replace type & attribute links
      await supabase.from('person_types').delete().eq('person_id', id);
      await supabase.from('person_attributes').delete().eq('person_id', id);
      if (types.length) {
        const { error } = await supabase.from('person_types').insert(types.map((type_id) => ({ person_id: id, type_id })));
        if (error) throw error;
      }
      if (attrs.length) {
        const { error } = await supabase.from('person_attributes').insert(attrs.map((attribute_id) => ({ person_id: id, attribute_id })));
        if (error) throw error;
      }
      toast('Saved');
      onSaved(id!);
      onClose();
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={person ? 'Edit Ishanga' : 'Add Ishanga / Volunteer'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Full name *">
        <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Phone">
          <Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Foundation email">
          <Input type="email" value={f.foundation_email} onChange={(e) => set('foundation_email', e.target.value)} />
        </Field>
        <Field label="Personal email">
          <Input type="email" value={f.personal_email} onChange={(e) => set('personal_email', e.target.value)} />
        </Field>
        <Field label="Other city / locality">
          <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Center">
          <Input value={f.center} onChange={(e) => set('center', e.target.value)} />
        </Field>
        <Field label="Secondary center">
          <Input value={f.secondary_center} onChange={(e) => set('secondary_center', e.target.value)} />
        </Field>
        <Field label="State">
          <Input value={f.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field label="Cluster">
          <select className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base sm:text-sm" value={f.cluster} onChange={(e) => set('cluster', e.target.value)}>
            <option value="">— Select cluster —</option>
            {ISHANGA_CLUSTERS.map((cluster) => <option key={cluster} value={cluster}>{cluster}</option>)}
          </select>
        </Field>
        <Field label="Batch">
          <Input value={f.batch} onChange={(e) => set('batch', e.target.value)} />
        </Field>
        <Field label="Gender">
          <Input value={f.gender} onChange={(e) => set('gender', e.target.value)} />
        </Field>
        <Field label="Area of expertise">
          <Input value={f.area_of_expertise} onChange={(e) => set('area_of_expertise', e.target.value)} />
        </Field>
      </div>
      <Field label="Region"><Input value="North Region" readOnly /></Field>
      <Field label="Google Meet link (for interviews)" hint="Their personal meeting link, e.g. https://meet.google.com/abc-defg-hij">
        <Input type="url" placeholder="https://meet.google.com/..." value={f.meet_link} onChange={(e) => set('meet_link', e.target.value)} />
      </Field>
      <Field label="Ishanga type" hint="Choose SPS or Satsang. Leave empty for a volunteer who is not yet an Ishanga.">
        <ChipSelect options={ishangaTypes.filter((type) => ['SPS Ishanga', 'Satsang Ishanga'].includes(type.name))} value={types} onChange={setTypes} single />
      </Field>
      <Field label="Attributes">
        <ChipSelect options={attributes} value={attrs} onChange={setAttrs} />
      </Field>
      <Field label="Languages (for interviews)">
        <ChipSelect options={[...new Set([...languages, ...langs])].map((l) => ({ id: l, name: l }))} value={langs} onChange={setLangs} />
      </Field>
      <Checkbox label="Active" checked={f.is_active} onChange={(v) => set('is_active', v)} />
      <Field label="Notes">
        <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </Modal>
  );
}
