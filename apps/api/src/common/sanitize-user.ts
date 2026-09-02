type UserWithPasswordHash = {
  passwordHash: string;
  [key: string]: unknown;
};

export function sanitizeUser<T extends UserWithPasswordHash>(user: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}