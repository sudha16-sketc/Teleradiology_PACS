import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { RegisterDto } from '../src/auth/auth.dto.js';
import {
  normalizePhone,
  normalizePhoneOrThrow,
  PHONE_VALIDATION_MESSAGE,
} from '../src/common/validators/phone.js';

describe('phone validation', () => {
  it('accepts exactly 10 digits and stores the canonical telephone number', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
    expect(normalizePhoneOrThrow('9876543210')).toBe('+919876543210');
    expect(normalizePhone('  ')).toBe('');
    expect(normalizePhoneOrThrow('  ')).toBeNull();
    expect(PHONE_VALIDATION_MESSAGE).toBe('Phone number must contain exactly 10 digits.');
  });

  it.each([
    '123456789',
    '12345678901',
    '98765a43210',
    '+919876543210',
    '+15551234567',
    '91 98765 43210',
    '9876543210 ext 2',
    '0123456789',
    '987654321/',
  ])('rejects invalid phone number %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
    expect(() => normalizePhoneOrThrow(input)).toThrow(PHONE_VALIDATION_MESSAGE);
  });

  it('validates raw RegisterDto phone input before service normalization', () => {
    const valid = plainToInstance(RegisterDto, { phone: '9876543210' });
    expect(valid.phone).toBe('9876543210');
    expect(validateSync(valid).filter((error) => error.property === 'phone')).toEqual([]);

    for (const input of ['98765abc10', '+919876543210', '0123456789']) {
      const invalid = plainToInstance(RegisterDto, { phone: input });
      const error = validateSync(invalid).find((e) => e.property === 'phone');
      expect(error?.constraints?.isPhone).toBe(PHONE_VALIDATION_MESSAGE);
    }
  });
});
