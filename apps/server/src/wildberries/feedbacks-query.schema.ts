import { z } from 'zod';

const integerString = z.string()
  .regex(/^\d+$/, 'Must contain only digits')
  .transform(Number);

export const feedbacksQuerySchema = z.strictObject({
  take: integerString
    .pipe(z.number().int().min(1).max(100))
    .default(50),
  skip: integerString
    .pipe(z.number().int().min(0).max(199_990))
    .default(0),
});

export type FeedbacksQuery =
  z.infer<typeof feedbacksQuerySchema>;
