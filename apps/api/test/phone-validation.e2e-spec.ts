import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { RegisterDto } from '../src/auth/auth.dto.js';
import {
  normalizePhone,
  normalizePhoneOrThrow,
} from '../src/common/validators/phone.js';

describe('phone validation', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+911123456789', '+911123456789'],
    ['+15551234567', '+15551234567'],
    ['', ''],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(normalizePhoneOrThrow(input)).toBe(expected || null);
  });

  it.each([
    '12345',
    '12345678901',
    '98765a43210',
    '+91 9876543210',
    '+91987654321012',
    '+0123456789',
    '9876543210 ext 2',
  ])('rejects invalid phone number %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
    expect(() => normalizePhoneOrThrow(input)).toThrow();
  });

  it('normalizes and validates RegisterDto phone input', () => {
    const valid = plainToInstance(RegisterDto, { phone: '9876543210' });
    expect(valid.phone).toBe('+919876543210');
    expect(validateSync(valid).filter((error) => error.property === 'phone')).toEqual([]);

    const invalid = plainToInstance(RegisterDto, { phone: '98765abc10' });
    expect(validateSync(invalid).some((error) => error.property === 'phone')).toBe(true);
  });
});
