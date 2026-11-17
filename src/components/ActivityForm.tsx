import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { addDaysISO, errMsg, todayISO } from '../lib/format';
import type { Activity } from '../lib/types';
import { useLookups } from '../context/LookupContext';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from './ui';

export default function ActivityForm({
  open,
  onClose,
  activity,
  defaultTypeId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  activity?: Activity | null;
  defaultTypeId?: string;
  onSaved: (id: string) => void;
}) {
  const { activityTypes, activityTypeById } = useLookups();
  const toast = useToast();
  const active = activityTypes.filter((t) => t.is_active || t.id === activity?.activity_type_id);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({
    activity_type_id: activity?.activity_type_id ?? defaultTypeId ?? active[0]?.id ?? '',
    title: activity?.title ?? '',
    start_date: activity?.start_date ?? todayISO(),
    end_date: activity?.end_date ?? '',
    start_time: activity?.start_time?.slice(0, 5) ?? '',
    location: activity?.location ?? '',
    city: activity?.city ?? '',
    region: activity?.region ?? 'North Bharat',
    opt_in_open: activity?.opt_in_open ?? true,
    notes: activity?.notes ?? '',
  }));
  const [repeat, setRepeat] = useState<'none' | 'weekly' | 'fortnightly' | 'monthly'>('none');
  const [count, setCount] = useState(4);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.activity_type_id) return toast('Choose an activity type', true);
    if (!f.start_date) return toast('Start date is required', true);
    setBusy(true);
    try {
      const base = {
        ...f,
        title: f.title.trim() || activityTypeById.get(f.activity_type_id)?.name || 'Activity',
        end_date: f.end_date || null,
        start_time: f.start_time || null,
        location: f.location || null,
        city: f.city || null,
        notes: f.notes || null,
      };
      if (activity) {
        const { error } = await supabase.from('activities').update(base).eq('id', activity.id);
        if (error) throw error;
        onSaved(activity.id);
      } else {
        const n = repeat === 'none' ? 1 : Math.max(1, Math.min(52, count));
        const span = base.end_date ? (new Date(base.end_date).getTime() - new Date(base.start_date).getTime()) / 86400000 : null;
        const rows = Array.from({ length: n }, (_, i) => {
          let start = base.start_date;
          if (repeat === 'weekly') start = addDaysISO(start, 7 * i);
          if (repeat === 'fortnightly') start = addDaysISO(start, 14 * i);
          if (repeat === 'monthly') {
            const d = new Date(start + 'T00:00:00');
            d.setMonth(d.getMonth() + i);
            start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
          return { ...base, start_date: start, end_date: span !== null ? addDaysISO(start, span) : null };
        });
        const { data, error } = await supabase.from('activities').insert(rows).select('id');
        if (error) throw error;
        toast(n > 1 ? `${n} activities created` : 'Activity created');
        onSaved(n > 1 ? '' : (data![0].id as string));
      }
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
      title={activity ? 'Edit activity' : 'New activity'}
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
      <Field label="Activity type *">
        <Select value={f.activity_type_id} onChange={(e) => set('activity_type_id', e.target.value)} disabled={!!activity}>
          {active.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" hint="Defaults to the activity type name.">
        <Input value={f.title} placeholder="e.g. Satsang at Noida Center" onChange={(e) => set('title', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Start date *">
          <Input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </Field>
        <Field label="End date">
          <Input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set('end_date', e.target.value)} />
        </Field>
        <Field label="Time">
          <Input type="time" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
      </div>
      <Field label="Venue / location">
        <Input value={f.location} onChange={(e) => set('location', e.target.value)} />
      </Field>
      <Field label="Region">
        <Input value={f.region} onChange={(e) => set('region', e.target.value)} />
      </Field>
      {!activity && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Repeat">
            <Select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
              <option value="none">Does not repeat</option>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
          {repeat !== 'none' && (
            <Field label="Occurrences">
              <Input type="number" min={1} max={52} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </Field>
          )}
        </div>
      )}
      <Checkbox label="Open for opt-in by Ishangas" checked={f.opt_in_open} onChange={(v) => set('opt_in_open', v)} />
      <Field label="Notes">
        <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </Modal>
  );
}
