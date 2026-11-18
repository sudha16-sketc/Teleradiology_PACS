"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { isValidPhone, PHONE_VALIDATION_MESSAGE } from "@/lib/phone";

interface PhoneFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export function PhoneField({
  value,
  onChange,
  disabled,
  placeholder = "9876543210 or +919876543210",
  required,
  className,
}: PhoneFieldProps) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.trim() !== "" && !isValidPhone(value);

  return (
    <div>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required={required}
        value={value}
        disabled={disabled}
        maxLength={16}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={invalid ? "phone-field-error" : undefined}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          setTouched(true);
          onChange(event.target.value);
        }}
        className={clsx(
          "w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60",
          invalid ? "border-error" : "border-border",
          className,
        )}
      />
      {invalid && (
        <p id="phone-field-error" className="mt-1 text-xs text-error">
          {PHONE_VALIDATION_MESSAGE}
        </p>
      )}
    </div>
  );
}
