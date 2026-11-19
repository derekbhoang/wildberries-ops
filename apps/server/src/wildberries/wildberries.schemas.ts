import { z } from 'zod';
import {
  feedbackAnswerStatusSchema,
  feedbackSchema,
  feedbacksPageSchema,
} from '@wildberries-ops/contracts';

export const feedbackAnswerResponseSchema = z.object({
  error: z.literal(false),
  data: feedbackAnswerStatusSchema,
});

export const feedbackForDraftResponseSchema = z.object({
  error: z.literal(false),
  data: feedbackSchema.extend({
    answer: feedbackAnswerStatusSchema.shape.answer,
  }),
});

export type FeedbackForDraft =
  z.infer<typeof feedbackForDraftResponseSchema>['data'];

export const feedbacksResponseSchema = z.object({
  error: z.literal(false),
  data: feedbacksPageSchema,
});

export type FeedbacksPage =
  z.infer<typeof feedbacksResponseSchema>['data'];
