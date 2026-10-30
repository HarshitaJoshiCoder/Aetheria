import { z } from 'zod';

export const roles = ['customer', 'admin', 'superadmin'] as const;
export const Role = z.enum(roles);
export type Role = z.infer<typeof Role>;

export const Email = z.string().trim().toLowerCase().email().max(254);

/** At least 8 chars with a letter and a digit; capped so hashing cost stays bounded. */
export const Password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const RegisterInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: Email,
  password: Password,
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const GoogleLoginInput = z.object({ idToken: z.string().min(1) });
export type GoogleLoginInput = z.infer<typeof GoogleLoginInput>;

export const PublicUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: Role,
  emailVerified: z.boolean(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const AuthResponse = z.object({
  accessToken: z.string(),
  user: PublicUser,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

/** Claims carried in an access token. `sub` is the user id. */
export const AccessTokenClaims = z.object({
  sub: z.string(),
  role: Role,
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;
