const icsDate = (ts: string) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);

export interface CalEvent {
  title: string;
  start: string;
  end: string;
  details?: string;
  location?: string;
}

export const googleCalUrl = (e: CalEvent) =>
  'https://calendar.google.com/calendar/render?' +
  new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsDate(e.start)}/${icsDate(e.end)}`,
    details: e.details ?? '',
    location: e.location ?? '',
  }).toString();

export function downloadIcs(e: CalEvent) {
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ishanga Scheduler//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${esc(e.title)}`,
    e.details ? `DESCRIPTION:${esc(e.details)}` : '',
    e.location ? `LOCATION:${esc(e.location)}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'interview.ics';
  a.click();
  URL.revokeObjectURL(url);
}

/** wa.me link; Indian 10-digit numbers get the 91 prefix. */
export const whatsappUrl = (phone: string | null | undefined, text: string) => {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  if (digits.startsWith('0') && digits.length === 11) digits = '91' + digits.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
};
