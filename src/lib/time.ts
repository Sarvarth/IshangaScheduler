// All interview times are entered and shown in India time, regardless of device time zone.
export const TZ = 'Asia/Kolkata';
const OFFSET = '+05:30';

export const toTs = (date: string, time: string) => `${date}T${time}:00${OFFSET}`;

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

export const istDate = (ts: string | Date) => dateFmt.format(new Date(ts));
export const istTime = (ts: string | Date) => timeFmt.format(new Date(ts));

export const label12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
};

export const fmtTime = (ts: string) => label12(istTime(ts));

export const fmtDay = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(date + 'T12:00:00' + OFFSET).toLocaleDateString('en-IN', { ...opts, timeZone: TZ });

export const fmtSlot = (ts: string) => `${fmtDay(istDate(ts))} · ${fmtTime(ts)}`;

export const addDays = (date: string, n: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const mondayOf = (date: string) => {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  return addDays(date, -((dow + 6) % 7));
};

export const todayIST = () => istDate(new Date());

/** 30-minute steps from 06:00 to 23:00 */
export const TIME_OPTIONS = Array.from({ length: 35 }, (_, i) => {
  const mins = 6 * 60 + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
});

export const slotCount = (start: string, end: string) => Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1800000));
