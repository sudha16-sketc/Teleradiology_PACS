import { BadRequestException } from '@nestjs/common';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
  type ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';

export const PHONE_VALIDATION_MESSAGE =
  'Phone number must contain exactly 10 digits.';

export const PHONE_INPUT_PATTERN = /^[0-9]{10}$/;

/**
 * Accepts exactly ten numeric digits and stores them in the canonical form
 * used by `tel:+91...` links. No country code, separators or truncation are
 * accepted from the client.
 */
export function normalizePhone(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (!PHONE_INPUT_PATTERN.test(trimmed) || trimmed.startsWith('0')) return null;
  return `+91${trimmed}`;
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
  return IsPhone();
}
