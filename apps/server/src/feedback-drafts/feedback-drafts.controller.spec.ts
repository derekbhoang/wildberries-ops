import {
  FakeModel,
  overrideModels,
  providerError,
  type FakeAnswer,
} from '@nestjs/ai/testing';
import {
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { feedbackDraftSchema } from '@wildberries-ops/contracts';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackForDraft } from '../wildberries/wildberries.schemas.js';
import { WildberriesService } from '../wildberries/wildberries.service.js';
import { FeedbackDraftsModule } from './feedback-drafts.module.js';

describe('POST /feedbacks/:id/draft', () => {
  const secret = 'test-secret-do-not-expose';
  const getFeedback = vi.fn<WildberriesService['getFeedbackForDraft']>();
  const answerFeedback = vi.fn<WildberriesService['answerFeedback']>();
  const feedback: FeedbackForDraft = {
    id: 'review-1',
    text: 'Good coffee',
    productValuation: 5,
    createdDate: '2026-11-18T00:00:00Z',
    productDetails: { nmId: 123, productName: 'Coffee' },
    answer: null,
  };
  const draft = { feedbackId: feedback.id, text: 'Спасибо за отзыв!' };
  let app: INestApplication<Server>;
  let model: FakeModel;
  let answer: FakeAnswer;

  beforeEach(async () => {
    vi.resetAllMocks();
    getFeedback.mockResolvedValue(feedback);
    answer = { object: { text: draft.text } };
    model = new FakeModel(() => answer);
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [
            () => ({
              WB_API_KEY: secret,
              OPENAI_API_KEY: secret,
              OPENAI_REPLY_MODEL: 'test-model',
            }),
          ],
        }),
        FeedbackDraftsModule,
      ],
    })
      .overrideProvider(WildberriesService)
      .useValue({
        getFeedbackForDraft: getFeedback,
        answerFeedback,
      });
    const moduleRef = await overrideModels(builder, {
      reviewReply: model,
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    app.useLogger(false);
    await app.init();
  });

  afterEach(async () => {
    expect(answerFeedback).not.toHaveBeenCalled();
    await app?.close();
  });

  it('returns an uncached JSON draft matching the shared contract without publishing', async () => {
    const response = await request(app.getHttpServer())
      .post('/feedbacks/%20review-1%20/draft')
      .expect('Content-Type', /json/)
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect(draft);

    expect(feedbackDraftSchema.parse(response.body)).toEqual(draft);
    expect(getFeedback).toHaveBeenCalledExactlyOnceWith(
      feedback.id,
      expect.any(AbortSignal),
    );
    expect(model.calls).toHaveLength(1);
    expect(model.lastCall!.tools).toEqual([]);
  });

  it('rejects a blank ID before fetching or generating', async () => {
    await request(app.getHttpServer()).post('/feedbacks/%20/draft').expect(400);

    expect(getFeedback).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(0);
  });

  it('uses server-fetched review context even if the client supplies forged fields', async () => {
    await request(app.getHttpServer())
      .post('/feedbacks/review-1/draft')
      .send({
        feedbackId: 'another-review',
        review: { text: secret },
        text: secret,
      })
      .expect(200)
      .expect(draft);

    expect(getFeedback).toHaveBeenCalledWith(
      feedback.id,
      expect.any(AbortSignal),
    );
    expect(JSON.parse(model.lastCall!.lastUserMessage!)).toEqual({
      review: { text: feedback.text, pros: null, cons: null, rating: 5 },
      product: { name: 'Coffee' },
    });
    expect(model.lastCall!.lastUserMessage).not.toContain(secret);
  });

  it.each(['reviewRequired', 'rejected'])(
    'returns 409 for an existing %s answer without calling AI',
    async (state) => {
      getFeedback.mockResolvedValueOnce({
        ...feedback,
        answer: { text: 'Existing reply', state },
      });

      const response = await request(app.getHttpServer())
        .post('/feedbacks/review-1/draft')
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'FEEDBACK_ALREADY_ANSWERED',
      });
      expect(model.calls).toHaveLength(0);
    },
  );

  it('returns 502 for a mismatched upstream review without calling AI', async () => {
    getFeedback.mockResolvedValueOnce({ ...feedback, id: 'another-review' });

    const response = await request(app.getHttpServer())
      .post('/feedbacks/review-1/draft')
      .expect(502);

    expect(response.body).toMatchObject({ code: 'WB_INVALID_RESPONSE' });
    expect(model.calls).toHaveLength(0);
  });

  it('preserves Wildberries cooldown metadata without calling AI', async () => {
    getFeedback.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'WB_RATE_LIMITED',
        retryAfterSeconds: 12,
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/feedbacks/review-1/draft')
      .expect(503);

    expect(response.body).toMatchObject({
      code: 'WB_RATE_LIMITED',
      retryAfterSeconds: 12,
    });
    expect(model.calls).toHaveLength(0);
  });

  it('returns a sanitized provider failure without retrying', async () => {
    answer = providerError(429, { message: secret });

    const response = await request(app.getHttpServer())
      .post('/feedbacks/review-1/draft')
      .expect(503);

    expect(response.body).toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(model.calls).toHaveLength(1);
  });

  it('returns 502 instead of exposing invalid AI output', async () => {
    answer = { text: secret };

    const response = await request(app.getHttpServer())
      .post('/feedbacks/review-1/draft')
      .expect(502);

    expect(response.body).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(model.calls).toHaveLength(1);
  });

  it('limits the configured seller across review IDs before fetching or calling AI', async () => {
    getFeedback.mockImplementation(async (id) => ({ ...feedback, id }));
    for (let index = 0; index < 10; index++) {
      await request(app.getHttpServer())
        .post(`/feedbacks/review-${index}/draft`)
        .set('X-Forwarded-For', `192.0.2.${index + 1}`)
        .expect(200);
    }

    const response = await request(app.getHttpServer())
      .post('/feedbacks/another-review/draft')
      .set('X-Forwarded-For', '198.51.100.1')
      .expect(429);

    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(getFeedback).toHaveBeenCalledTimes(10);
    expect(model.calls).toHaveLength(10);
  });
});
