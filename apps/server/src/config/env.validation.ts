import { z } from 'zod';

const requiredString = z
  .string({ error: 'is required' })
  .trim()
  .min(1, 'is required');
const portError = 'must be an integer from 0 to 65535';

export const envSchema = z.object({
  PORT: z
    .string({ error: portError })
    .trim()
    .regex(/^\d+$/, portError)
    .transform(Number)
    .refine((port) => port <= 65_535, portError)
    .default(3000),
  WB_API_KEY: requiredString,
  OPENAI_API_KEY: requiredString,
  OPENAI_REPLY_MODEL: requiredString,
});

export type Env = z.infer<typeof envSchema>;
