import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { color } from '../lib/format';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-orange-800 text-white hover:bg-orange-900 disabled:bg-orange-300',
  secondary: 'bg-white text-stone-800 border border-stone-300 hover:bg-stone-100 disabled:opacity-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
  ghost: 'text-stone-700 hover:bg-stone-100 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
        variants[variant],
        className,
      )}
    />
  );
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx('rounded-xl border border-stone-200 bg-white p-4 shadow-sm', onClick && 'cursor-pointer hover:border-orange-300', className)}
    >
      {children}
    </div>
  );
}

export function Badge({ children, c }: { children: ReactNode; c?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', color(c).badge)}>{children}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base sm:text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200';

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-stone-700">
      <input type="checkbox" className="h-4 w-4 accent-orange-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Toggleable chips for multi-select (types, attributes, filters). */
export function ChipSelect({
  options,
  value,
  onChange,
  single,
}: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  single?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            type="button"
            key={o.id}
            onClick={() => onChange(single ? (on ? [] : [o.id]) : on ? value.filter((v) => v !== o.id) : [...value, o.id])}
            className={cx(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              on ? 'border-orange-700 bg-orange-700 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100',
            )}
          >
            {o.name}
          </button>
        );
      })}
      {options.length === 0 && <span className="text-sm text-stone-500">None configured yet.</span>}
    </div>
  );
}

/** Bottom sheet on mobile, centered dialog on larger screens. */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-2xl leading-none text-stone-500 hover:bg-stone-100" aria-label="Close">
            ×
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-stone-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{children}</div>
);

export const Spinner = () => (
  <div className="flex justify-center p-8">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-700" />
  </div>
);

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
            value === t.id ? 'bg-orange-800 text-white' : 'bg-white text-stone-700 border border-stone-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3">
        {toasts.map((t) => (
          <div key={t.id} className={cx('rounded-lg px-4 py-2 text-sm text-white shadow-lg', t.error ? 'bg-rose-600' : 'bg-stone-800')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
