import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { addDaysISO, errMsg, todayISO } from '../lib/format';
import type { Activity } from '../lib/types';
import { useLookups } from '../context/LookupContext';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from './ui';

type Repeat = 'none' | 'weekly' | 'fortnightly' | 'monthly' | 'first_sunday';
type VisibilityMode = 'immediate' | 'one_month' | '15_days' | '7_days' | 'custom';

const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const firstSunday = (year: number, month: number) => {
  const first = new Date(year, month, 1, 12);
  first.setDate(1 + ((7 - first.getDay()) % 7));
  return isoDate(first);
};

const oneMonthBefore = (iso: string) => {
  const date = new Date(`${iso}T12:00:00`);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  return isoDate(date);
};

const modeFor = (activity?: Activity | null): VisibilityMode => {
  if (!activity?.visible_from) return 'immediate';
  if (activity.visible_from === oneMonthBefore(activity.start_date)) return 'one_month';
  if (activity.visible_from === addDaysISO(activity.start_date, -15)) return '15_days';
  if (activity.visible_from === addDaysISO(activity.start_date, -7)) return '7_days';
  return 'custom';
};

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
  const initialTypeId = activity?.activity_type_id ?? defaultTypeId ?? active[0]?.id ?? '';
  const initialSatsang = activityTypeById.get(initialTypeId)?.name.toLowerCase() === 'satsang';
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({
    activity_type_id: initialTypeId,
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
  const [center, setCenter] = useState(activity?.center ?? '');
  const [centers, setCenters] = useState<string[]>([]);
  const [showEvent, setShowEvent] = useState(activity?.is_visible ?? true);
  const [repeat, setRepeat] = useState<Repeat>(initialSatsang ? 'first_sunday' : 'none');
  const [count, setCount] = useState(initialSatsang ? 12 : 4);
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>(() => modeFor(activity));
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const isSatsang = activityTypeById.get(f.activity_type_id)?.name.toLowerCase() === 'satsang';

  useEffect(() => {
    supabase
      .from('people')
      .select('center')
      .not('center', 'is', null)
      .then(({ data }) => setCenters([...new Set((data ?? []).map((p) => p.center as string).filter(Boolean))].sort()));
  }, []);

  const save = async () => {
    if (!f.activity_type_id) return toast('Choose an activity type', true);
    if (!f.start_date) return toast('Start date is required', true);
    if (isSatsang && !center.trim()) return toast('Choose a center for this Satsang', true);
    setBusy(true);
    try {
      const base = {
        ...f,
        title: f.title.trim() || activityTypeById.get(f.activity_type_id)?.name || 'Activity',
        end_date: f.end_date || null,
        start_time: f.start_time || null,
        location: f.location || null,
        city: f.city || null,
        center: isSatsang ? center.trim() : activity?.center ?? null,
        is_visible: isSatsang ? showEvent : activity?.is_visible ?? true,
        notes: f.notes || null,
      };
      if (activity) {
        const visibleFrom = isSatsang
          ? !showEvent
            ? null
            : visibilityMode === 'one_month'
              ? oneMonthBefore(base.start_date)
              : visibilityMode === '15_days'
                ? addDaysISO(base.start_date, -15)
                : visibilityMode === '7_days'
                  ? addDaysISO(base.start_date, -7)
                  : visibilityMode === 'custom'
                    ? activity.visible_from
                    : null
          : activity.visible_from;
        const { error } = await supabase.from('activities').update({ ...base, visible_from: visibleFrom }).eq('id', activity.id);
        if (error) throw error;
        onSaved(activity.id);
      } else {
        const n = repeat === 'none' ? 1 : Math.max(1, Math.min(52, count));
        const span = base.end_date ? (new Date(base.end_date).getTime() - new Date(base.start_date).getTime()) / 86400000 : null;
        const starts: string[] = [];
        if (repeat === 'first_sunday') {
          const firstMonth = new Date(`${base.start_date}T12:00:00`);
          for (let month = 0; starts.length < n; month++) {
            const first = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + month, 1, 12);
            const start = firstSunday(first.getFullYear(), first.getMonth());
            if (start >= base.start_date) starts.push(start);
          }
        } else {
          for (let i = 0; i < n; i++) {
            let start = base.start_date;
            if (repeat === 'weekly') start = addDaysISO(start, 7 * i);
            if (repeat === 'fortnightly') start = addDaysISO(start, 14 * i);
            if (repeat === 'monthly') {
              const date = new Date(`${start}T12:00:00`);
              date.setMonth(date.getMonth() + i);
              start = isoDate(date);
            }
            starts.push(start);
          }
        }
        const rows = starts.map((start) => {
          const visibleFrom =
            !showEvent
              ? null
              : visibilityMode === 'one_month'
              ? oneMonthBefore(start)
              : visibilityMode === '15_days'
                ? addDaysISO(start, -15)
                : visibilityMode === '7_days'
                  ? addDaysISO(start, -7)
                  : null;
          return { ...base, start_date: start, end_date: span !== null ? addDaysISO(start, span) : null, visible_from: visibleFrom };
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
        <Select
          value={f.activity_type_id}
          onChange={(e) => {
            const typeId = e.target.value;
            const satsang = activityTypeById.get(typeId)?.name.toLowerCase() === 'satsang';
            set('activity_type_id', typeId);
            if (satsang) {
              setRepeat('first_sunday');
              setCount(12);
            } else if (repeat === 'first_sunday') {
              setRepeat('none');
            }
          }}
          disabled={!!activity}
        >
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
      {isSatsang && (
        <>
          <Field label="Center *" hint="Each center has its own Satsang event; Ishangas can filter by center and opt in to that event.">
            <Input list="satsang-centers" value={center} onChange={(e) => setCenter(e.target.value)} />
            <datalist id="satsang-centers">
              {centers.map((name) => <option key={name} value={name} />)}
            </datalist>
          </Field>
          <Checkbox label="Show this event to Ishangas" checked={showEvent} onChange={setShowEvent} />
          {showEvent && (
            <Field label="Show event">
              <Select value={visibilityMode} onChange={(e) => setVisibilityMode(e.target.value as VisibilityMode)}>
                <option value="immediate">Immediately</option>
                <option value="one_month">1 month before</option>
                <option value="15_days">15 days before</option>
                <option value="7_days">7 days before</option>
                {visibilityMode === 'custom' && <option value="custom">Keep current schedule</option>}
              </Select>
            </Field>
          )}
        </>
      )}
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
              {isSatsang && <option value="first_sunday">First Sunday each month</option>}
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
