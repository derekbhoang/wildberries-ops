import { z } from 'zod';
import {
  feedbackAnswerStatusSchema,
  feedbackSchema,
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
  data: z.object({
    countUnanswered: z.number().int().nonnegative(),
    countArchive: z.number().int().nonnegative(),
    feedbacks: z.array(
      z.object({
        id: z.string(),
        text: z.string().nullish(),
        pros: z.string().nullish(),
        cons: z.string().nullish(),
        productValuation: z.number(),
        createdDate: z.string(),
        productDetails: z.object({
          nmId: z.number(),
          productName: z.string().nullish(),
        }).nullish(),
      }),
    ),
  }),
});

export type FeedbacksPage =
  z.infer<typeof feedbacksResponseSchema>['data'];
