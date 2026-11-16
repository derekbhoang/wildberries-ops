import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FeedbacksController } from './feedbacks.controller.js';
import type { FeedbacksPage } from './wildberries.schemas.js';
import { WildberriesService } from './wildberries.service.js';

describe('FeedbacksController', () => {
  let app: INestApplication<Server>;
  const listUnansweredFeedbacks =
    vi.fn<WildberriesService['listUnansweredFeedbacks']>();
  const getFeedbackAnswer = vi.fn<WildberriesService['getFeedbackAnswer']>();
  const answerFeedback = vi.fn<WildberriesService['answerFeedback']>();
  const page: FeedbacksPage = {
    countUnanswered: 12,
    countArchive: 30,
    feedbacks: [
      {
        id: 'review-1',
        text: 'Great product',
        productValuation: 5,
        createdDate: '2026-11-12T00:00:00Z',
        productDetails: { nmId: 123, productName: 'Coffee' },
      },
    ],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FeedbacksController],
      providers: [
        {
          provide: WildberriesService,
          useValue: {
            listUnansweredFeedbacks,
            getFeedbackAnswer,
            answerFeedback,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<INestApplication<Server>>();
    await app.init();
  });

  beforeEach(() => {
    listUnansweredFeedbacks.mockReset();
    listUnansweredFeedbacks.mockResolvedValue(page);
    getFeedbackAnswer.mockReset();
    getFeedbackAnswer.mockResolvedValue({ id: 'review-1', answer: null });
    answerFeedback.mockReset();
    answerFeedback.mockResolvedValue({ status: 'submitted' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns JSON and supplies default pagination', async () => {
    await request(app.getHttpServer())
      .get('/feedbacks')
      .expect('Content-Type', /json/)
      .expect(200)
      .expect(page);

    expect(listUnansweredFeedbacks).toHaveBeenCalledExactlyOnceWith({
      take: 50,
      skip: 0,
    });
  });

  it.each([
    { query: 'take=10&skip=20', options: { take: 10, skip: 20 } },
    { query: 'take=1', options: { take: 1, skip: 0 } },
    { query: 'skip=100', options: { take: 50, skip: 100 } },
    { query: 'take=100&skip=199990', options: { take: 100, skip: 199_990 } },
  ])('parses pagination from $query', async ({ query, options }) => {
    await request(app.getHttpServer())
      .get(`/feedbacks?${query}`)
      .expect(200)
      .expect(page);

    expect(listUnansweredFeedbacks).toHaveBeenCalledExactlyOnceWith(options);
  });

  it('returns a successful empty page', async () => {
    const emptyPage: FeedbacksPage = {
      countUnanswered: 0,
      countArchive: 30,
      feedbacks: [],
    };
    listUnansweredFeedbacks.mockResolvedValueOnce(emptyPage);

    await request(app.getHttpServer())
      .get('/feedbacks')
      .expect(200)
      .expect(emptyPage);
  });

  it('returns uncached reply status for the requested review', async () => {
    await request(app.getHttpServer())
      .get('/feedbacks/review-1/answer')
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect({ id: 'review-1', answer: null });

    expect(getFeedbackAnswer).toHaveBeenCalledExactlyOnceWith('review-1');
  });

  it('rejects an empty review ID before checking upstream', async () => {
    await request(app.getHttpServer())
      .get('/feedbacks/%20/answer')
      .expect(400);

    expect(getFeedbackAnswer).not.toHaveBeenCalled();
  });

  it('returns status-check cooldown metadata', async () => {
    getFeedbackAnswer.mockRejectedValueOnce(new ServiceUnavailableException({
      code: 'WB_RATE_LIMITED',
      retryAfterSeconds: 12,
    }));

    const response = await request(app.getHttpServer())
      .get('/feedbacks/review-1/answer')
      .expect(503);

    expect(response.body).toMatchObject({
      code: 'WB_RATE_LIMITED',
      retryAfterSeconds: 12,
    });
  });

  it.each([
    'take=0',
    'take=101',
    'skip=-1',
    'skip=199991',
    'take=1.5',
    'take=abc',
    'take=',
    'skip=',
    'take=1&take=2',
    'skip=0&skip=20',
    'take=1e2',
    'take=0x10',
    'take=9007199254740992',
    'take%5Bvalue%5D=10',
    'isAnswered=true',
  ])('rejects invalid query %s before calling the service', async (query) => {
    await request(app.getHttpServer()).get(`/feedbacks?${query}`).expect(400);

    expect(listUnansweredFeedbacks).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'seller access failure',
      status: 502,
      makeError: () =>
        new BadGatewayException({
          code: 'WB_ACCESS_DENIED',
          message: 'Check the Wildberries API key and its permissions',
        }),
    },
    {
      name: 'rate limit and retry metadata',
      status: 503,
      makeError: () =>
        new ServiceUnavailableException({
          code: 'WB_RATE_LIMITED',
          message: 'Wildberries request limit reached',
          retryAfterSeconds: 12,
        }),
    },
    {
      name: 'timeout',
      status: 504,
      makeError: () => new GatewayTimeoutException(),
    },
  ])('preserves the service $name', async ({ status, makeError }) => {
    const error = makeError();
    listUnansweredFeedbacks.mockRejectedValueOnce(error);

    const response = await request(app.getHttpServer())
      .get('/feedbacks')
      .expect(status);

    expect(response.body).toEqual(error.getResponse());
    expect(listUnansweredFeedbacks).toHaveBeenCalledTimes(1);
  });

  describe('POST /feedbacks/:id/answer', () => {
    it('submits the trimmed reply and returns JSON with HTTP 200', async () => {
      await request(app.getHttpServer())
        .post('/feedbacks/%20review-1%20/answer')
        .send({ text: '  Thank you!\nWe appreciate your feedback.  ' })
        .expect('Content-Type', /json/)
        .expect(200)
        .expect({ status: 'submitted' });

      expect(answerFeedback).toHaveBeenCalledExactlyOnceWith('review-1', {
        text: 'Thank you!\nWe appreciate your feedback.',
      });
    });

    it.each([
      { name: 'minimum length', text: 'OK' },
      { name: 'maximum length', text: 'a'.repeat(5000) },
    ])('accepts a reply at $name', async ({ text }) => {
      await request(app.getHttpServer())
        .post('/feedbacks/review-1/answer')
        .send({ text })
        .expect(200)
        .expect({ status: 'submitted' });

      expect(answerFeedback).toHaveBeenCalledExactlyOnceWith('review-1', {
        text,
      });
    });

    it.each([
      { name: 'missing text', body: {} },
      { name: 'null text', body: { text: null } },
      { name: 'numeric text', body: { text: 123 } },
      { name: 'array text', body: { text: ['Thank you!'] } },
      { name: 'empty text', body: { text: '' } },
      { name: 'whitespace-only text', body: { text: ' \n\t ' } },
      { name: 'one character', body: { text: 'a' } },
      { name: 'one character after trimming', body: { text: '  a  ' } },
      { name: 'overlong text', body: { text: 'a'.repeat(5001) } },
      {
        name: 'unexpected body fields',
        body: { text: 'Thank you!', id: 'another-review' },
      },
    ])('rejects $name before calling the service', async ({ body }) => {
      await request(app.getHttpServer())
        .post('/feedbacks/review-1/answer')
        .send(body)
        .expect(400);

      expect(answerFeedback).not.toHaveBeenCalled();
    });

    it('rejects an empty review ID before calling the service', async () => {
      await request(app.getHttpServer())
        .post('/feedbacks/%20/answer')
        .send({ text: 'Thank you!' })
        .expect(400);

      expect(answerFeedback).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'reply rejection',
        status: 400,
        makeError: () => new BadRequestException({
          code: 'WB_REPLY_REJECTED',
          message: 'Wildberries rejected the reply',
        }),
      },
      {
        name: 'seller access failure',
        status: 502,
        makeError: () => new BadGatewayException({
          code: 'WB_ACCESS_DENIED',
          message: 'Check the Wildberries API key and its permissions',
        }),
      },
      {
        name: 'rate limit and cooldown',
        status: 503,
        makeError: () => new ServiceUnavailableException({
          code: 'WB_RATE_LIMITED',
          message: 'Wildberries request limit reached',
          retryAfterSeconds: 12,
        }),
      },
      {
        name: 'uncertain submission',
        status: 502,
        makeError: () => new BadGatewayException({
          code: 'WB_SUBMISSION_UNKNOWN',
          message: 'Check the review before attempting to send the reply again',
        }),
      },
    ])('preserves the service $name', async ({ status, makeError }) => {
      const error = makeError();
      answerFeedback.mockRejectedValueOnce(error);

      const response = await request(app.getHttpServer())
        .post('/feedbacks/review-1/answer')
        .send({ text: 'Thank you!' })
        .expect(status);

      expect(response.body).toEqual(error.getResponse());
      expect(answerFeedback).toHaveBeenCalledExactlyOnceWith('review-1', {
        text: 'Thank you!',
      });
    });
  });
});
