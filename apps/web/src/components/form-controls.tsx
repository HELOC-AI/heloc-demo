import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const control =
  'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 shadow-xs transition ' +
  'placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/15 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ' +
  'aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/15 sm:text-sm';

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  className?: string;
  children: (describedBy: { 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + control + hint/error, wired up for assistive tech. */
export function Field({ id, label, error, hint, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children({ 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error && (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm text-red-600">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            fill="currentColor"
            className="mt-0.5 size-4 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}
      {hint && (
        <div id={hintId} className="mt-1.5 text-sm text-slate-500">
          {hint}
        </div>
      )}
    </div>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, ...props }: TextInputProps) {
  return <input className={`${control} ${className ?? ''}`} {...props} />;
}

/** A dollar amount typed as text ("800,000"), with a leading "$". */
export function MoneyInput({ className, ...props }: TextInputProps) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500 sm:text-sm"
      >
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`${control} pl-7 tabular-nums ${className ?? ''}`}
        {...props}
      />
    </div>
  );
}

interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  placeholder?: string;
  options: readonly { value: string; label: string }[];
}

export function SelectInput({ placeholder, options, className, ...props }: SelectInputProps) {
  return (
    <div className="relative">
      <select
        className={`${control} appearance-none pr-10 invalid:text-slate-400 ${className ?? ''}`}
        {...props}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="currentColor"
        className="pointer-events-none absolute inset-y-0 right-3 my-auto size-5 text-slate-400"
      >
        <path
          fillRule="evenodd"
          d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className ?? 'size-5'}`}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
