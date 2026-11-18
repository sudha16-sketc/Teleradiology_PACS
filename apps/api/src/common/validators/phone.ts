import { applyDecorators, BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
  type ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';

export const PHONE_VALIDATION_MESSAGE =
  'Enter digits only with an optional leading +. Indian numbers: 10 digits, or +91 followed by 10 digits.';

export function normalizePhone(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (!/^\+?\d+$/.test(trimmed)) return null;

  const hasCountryCode = trimmed.startsWith('+');
  const digits = hasCountryCode ? trimmed.slice(1) : trimmed;
  if (/^0/.test(digits)) return null;

  if (!hasCountryCode) {
    return digits.length === 10 ? `+91${digits}` : null;
  }
  if (digits.startsWith('91')) {
    return digits.length === 12 ? `+${digits}` : null;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export function normalizePhoneOrThrow(value: unknown): string | null {
  const normalized = normalizePhone(value);
  if (normalized === null) {
    throw new BadRequestException(PHONE_VALIDATION_MESSAGE);
  }
  return normalized === '' ? null : normalized;
}

@ValidatorConstraint({ name: 'isPhone', async: false })
class IsPhoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    return normalizePhone(value) !== null;
  }

  defaultMessage(): string {
    return PHONE_VALIDATION_MESSAGE;
  }
}

export function IsPhone(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: IsPhoneConstraint,
    });
  };
}

export function IsPhoneInput(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => {
      if (value === undefined || value === null) return value;
      const normalized = normalizePhone(value);
      return normalized === null ? value : normalized;
    }),
    IsPhone(),
  );
}
