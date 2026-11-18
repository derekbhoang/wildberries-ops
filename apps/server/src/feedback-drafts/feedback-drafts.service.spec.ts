import {
  BadGatewayException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FeedbackAnswer } from '@wildberries-ops/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackForDraft } from '../wildberries/wildberries.schemas.js';
import { WildberriesService } from '../wildberries/wildberries.service.js';
import { FeedbackDraftsService } from './feedback-drafts.service.js';
import { ReviewReplyGeneratorService } from './review-reply-generator.service.js';

describe('FeedbackDraftsService', () => {
  const getFeedback = vi.fn<WildberriesService['getFeedbackForDraft']>();
  const answerFeedback = vi.fn<WildberriesService['answerFeedback']>();
  const generateReply = vi.fn<ReviewReplyGeneratorService['generate']>();
  const feedback: FeedbackForDraft = {
    id: 'review-1',
    text: '  Good coffee\n  ',
    pros: '  Fresh  ',
    cons: ' \n\t ',
    productValuation: 4,
    createdDate: '2026-11-18T00:00:00Z',
    productDetails: { nmId: 123, productName: '  Coffee  ' },
    answer: null,
  };
  let service: FeedbackDraftsService;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    getFeedback.mockResolvedValue(feedback);
    generateReply.mockResolvedValue({
      text: '  Thank you!\nWe appreciate it.  ',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        FeedbackDraftsService,
        {
          provide: WildberriesService,
          useValue: { getFeedbackForDraft: getFeedback, answerFeedback },
        },
        {
          provide: ReviewReplyGeneratorService,
          useValue: { generate: generateReply },
        },
      ],
    }).compile();
    service = moduleRef.get(FeedbackDraftsService);
  });

  afterEach(() => {
    expect(answerFeedback).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the requested review ID and a validated, trimmed draft without publishing', async () => {
    await expect(service.generate('  review-1  ')).resolves.toEqual({
      feedbackId: 'review-1',
      text: 'Thank you!\nWe appreciate it.',
    });

    expect(getFeedback).toHaveBeenCalledExactlyOnceWith(
      'review-1',
      expect.any(AbortSignal),
    );
    expect(generateReply).toHaveBeenCalledExactlyOnceWith(
      {
        review: { text: 'Good coffee', pros: 'Fresh', cons: null, rating: 4 },
        product: { nmId: 123, name: 'Coffee' },
      },
      getFeedback.mock.calls[0]![1],
    );
  });

  it('passes only permitted review and product fields to the generator', async () => {
    getFeedback.mockResolvedValueOnce({
      ...feedback,
      customerEmail: 'private@example.test',
      apiKey: 'private-key',
      productDetails: {
        ...feedback.productDetails!,
        supplierSecret: 'private',
      },
    } as FeedbackForDraft);

    await service.generate(feedback.id);

    expect(generateReply.mock.calls[0]![0]).toEqual({
      review: { text: 'Good coffee', pros: 'Fresh', cons: null, rating: 4 },
      product: { nmId: 123, name: 'Coffee' },
    });
  });

  it.each([
    { name: 'absent fields', optional: {} },
    {
      name: 'null fields',
      optional: { text: null, pros: null, cons: null, productDetails: null },
    },
    {
      name: 'blank fields',
      optional: { text: '  ', pros: '\n', cons: '\t', productDetails: null },
    },
  ])('supports rating-only reviews with $name', async ({ optional }) => {
    getFeedback.mockResolvedValueOnce({
      id: feedback.id,
      productValuation: 2,
      createdDate: feedback.createdDate,
      answer: null,
      ...optional,
    });

    await service.generate(feedback.id);

    expect(generateReply).toHaveBeenCalledWith(
      {
        review: { text: null, pros: null, cons: null, rating: 2 },
        product: null,
      },
      expect.any(AbortSignal),
    );
  });

  it.each([undefined, null, '  '])(
    'supports an unavailable product name: %j',
    async (productName) => {
      getFeedback.mockResolvedValueOnce({
        ...feedback,
        productDetails: { nmId: 123, productName },
      });

      await service.generate(feedback.id);

      expect(generateReply.mock.calls[0]![0].product).toEqual({
        nmId: 123,
        name: null,
      });
    },
  );

  it.each(['', ' \n\t '])(
    'rejects invalid ID %j before fetching or generating',
    async (id) => {
      await expect(service.generate(id)).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_FEEDBACK_ID' },
      });
      expect(getFeedback).not.toHaveBeenCalled();
      expect(generateReply).not.toHaveBeenCalled();
    },
  );

  it('rejects a mismatched upstream review before generating', async () => {
    getFeedback.mockResolvedValueOnce({ ...feedback, id: 'another-review' });

    await expect(service.generate(feedback.id)).rejects.toMatchObject({
      status: 502,
      response: { code: 'WB_INVALID_RESPONSE' },
    });
    expect(generateReply).not.toHaveBeenCalled();
  });

  it.each(['reviewRequired', 'rejected', 'published'])(
    'rejects an existing %s answer before generating',
    async (state) => {
      getFeedback.mockResolvedValueOnce({
        ...feedback,
        answer: { text: 'Existing reply', state },
      });

      await expect(service.generate(feedback.id)).rejects.toMatchObject({
        status: 409,
        response: { code: 'FEEDBACK_ALREADY_ANSWERED' },
      });
      expect(generateReply).not.toHaveBeenCalled();
    },
  );

  it.each([
    new BadGatewayException({ code: 'WB_ACCESS_DENIED' }),
    new BadGatewayException({ code: 'WB_INVALID_RESPONSE' }),
    new ServiceUnavailableException({
      code: 'WB_RATE_LIMITED',
      retryAfterSeconds: 12,
    }),
    new GatewayTimeoutException(),
  ])(
    'preserves an upstream failure and skips generation: %#',
    async (error) => {
      getFeedback.mockRejectedValueOnce(error);

      await expect(service.generate(feedback.id)).rejects.toBe(error);
      expect(generateReply).not.toHaveBeenCalled();
    },
  );

  it.each([
    new BadGatewayException({ code: 'AI_INVALID_RESPONSE' }),
    new ServiceUnavailableException({ code: 'AI_UNAVAILABLE' }),
    new GatewayTimeoutException({ code: 'AI_TIMEOUT' }),
  ])('preserves an AI failure without retrying: %#', async (error) => {
    generateReply.mockRejectedValueOnce(error);

    await expect(service.generate(feedback.id)).rejects.toBe(error);
    expect(generateReply).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'missing text', output: {} },
    { name: 'null output', output: null },
    { name: 'non-string text', output: { text: 123 } },
    { name: 'empty text', output: { text: '' } },
    { name: 'blank text', output: { text: ' \n\t ' } },
    { name: 'too short after trimming', output: { text: ' a ' } },
    { name: 'overlong text', output: { text: 'a'.repeat(5001) } },
    { name: 'unexpected fields', output: { text: 'Thank you!', extra: true } },
  ])('rejects $name even if the generator returns it', async ({ output }) => {
    // Deliberately violate the provider's TypeScript contract to test runtime validation.
    generateReply.mockResolvedValueOnce(output as unknown as FeedbackAnswer);

    await expect(service.generate(feedback.id)).rejects.toMatchObject({
      status: 502,
      response: { code: 'AI_INVALID_RESPONSE' },
    });
    expect(generateReply).toHaveBeenCalledTimes(1);
  });

  it.each([2, 5000])(
    'accepts valid output at the %i-character boundary',
    async (length) => {
      const text = 'a'.repeat(length);
      generateReply.mockResolvedValueOnce({ text: `  ${text}  ` });

      await expect(service.generate(feedback.id)).resolves.toEqual({
        feedbackId: feedback.id,
        text,
      });
    },
  );

  it('aborts a stalled review fetch at the overall deadline without starting AI', async () => {
    vi.useFakeTimers();
    getFeedback.mockImplementationOnce(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), {
            once: true,
          });
        }),
    );
    const result = service.generate(feedback.id);
    const failure = expect(result).rejects.toMatchObject({
      status: 504,
      response: { code: 'DRAFT_TIMEOUT' },
    });

    await vi.advanceTimersByTimeAsync(25_000);
    await failure;

    expect(getFeedback.mock.calls[0]![1]?.aborted).toBe(true);
    expect(generateReply).not.toHaveBeenCalled();
  });

  it('shares the 25-second deadline across fetching and generation', async () => {
    vi.useFakeTimers();
    getFeedback.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(feedback), 20_000);
        }),
    );
    generateReply.mockImplementationOnce(
      (_context, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), {
            once: true,
          });
        }),
    );
    const result = service.generate(feedback.id);
    const failure = expect(result).rejects.toMatchObject({
      status: 504,
      response: { code: 'DRAFT_TIMEOUT' },
    });

    await vi.advanceTimersByTimeAsync(24_999);
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(generateReply.mock.calls[0]![1]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(generateReply.mock.calls[0]![1]).toBe(getFeedback.mock.calls[0]![1]);
    expect(generateReply.mock.calls[0]![1]?.aborted).toBe(true);
  });
});
