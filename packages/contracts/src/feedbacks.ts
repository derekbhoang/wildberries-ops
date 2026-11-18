import { z } from "zod";

export const feedbackProductDetailsSchema = z.object({
  nmId: z.number(),
  productName: z.string().nullish(),
});

export const feedbackSchema = z.object({
  id: z.string(),
  text: z.string().nullish(),
  pros: z.string().nullish(),
  cons: z.string().nullish(),
  productValuation: z.number(),
  createdDate: z.string(),
  productDetails: feedbackProductDetailsSchema.nullish(),
});

// Public response returned by GET /feedbacks.
export const feedbacksPageSchema = z.object({
  countUnanswered: z.number().int().nonnegative(),
  countArchive: z.number().int().nonnegative(),
  feedbacks: z.array(feedbackSchema),
});

export type FeedbackProductDetails = z.infer<
  typeof feedbackProductDetailsSchema
>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type FeedbacksPage = z.infer<typeof feedbacksPageSchema>;

export const feedbackIdSchema = z.string().trim().min(1);

export const feedbackAnswerSchema = z.strictObject({
  text: z.string().trim().min(2).max(5000),
});

export type FeedbackAnswer = z.infer<typeof feedbackAnswerSchema>;

export const feedbackDraftSchema = z.strictObject({
  feedbackId: feedbackIdSchema,
  text: feedbackAnswerSchema.shape.text,
});

export type FeedbackDraft = z.infer<typeof feedbackDraftSchema>;

export type FeedbackAnswerResult = {
  status: "submitted";
};

export const feedbackAnswerStatusSchema = z.object({
  id: z.string(),
  answer: z.object({
    text: z.string(),
    state: z.string(),
  }).nullable(),
});

export type FeedbackAnswerStatus = z.infer<typeof feedbackAnswerStatusSchema>;
