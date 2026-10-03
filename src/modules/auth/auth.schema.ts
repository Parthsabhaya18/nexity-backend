import { z } from 'zod';

import { GENDERS } from '../users/user.model';

const MIN_AGE = 18;

export const emailSchema = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }));

export const usernameSchema = z
  .string({ error: 'Choose a username.' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,30}$/, 'Use 3–30 lowercase letters, numbers, dots or underscores.');

export const passwordSchema = z
  .string({ error: 'Enter a password.' })
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one number.');

const codeSchema = z
  .string({ error: 'Enter the 6-digit code.' })
  .trim()
  .regex(/^\d{6}$/, 'Enter all 6 digits.');

function ageOn(dob: Date, today = new Date()) {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export const registerSchema = z.object({
  display_name: z
    .string({ error: 'Please enter your name.' })
    .trim()
    .min(2, 'Please enter your name.')
    .max(50, 'Use at most 50 characters.'),
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  gender: z.enum(GENDERS, { error: 'Please choose an option.' }),
  date_of_birth: z
    .string({ error: 'Please enter your date of birth.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Please enter your date of birth.')
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1900, 'Enter a valid date.')
    .refine((d) => ageOn(d) >= MIN_AGE, `You must be ${MIN_AGE} or older to use Nexity.`),
  accept_terms: z.literal(true, { error: 'Please accept the Terms and Privacy Policy.' }),
});

export const loginSchema = z.object({
  identifier: z
    .string({ error: 'Enter your email or username.' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your email or username.'),
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
});

export const emailOnlySchema = z.object({ email: emailSchema });

export const verifyCodeSchema = z.object({ email: emailSchema, code: codeSchema });

export const resetPasswordSchema = z.object({
  reset_token: z.string().min(1, 'Reset token is required.'),
  password: passwordSchema,
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required.'),
});

export const usernameQuerySchema = z.object({ username: z.string().default('') });
