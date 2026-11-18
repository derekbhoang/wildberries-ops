import { HttpException, Logger } from '@nestjs/common';
import { HttpClient } from '@nestjs/http-client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { WildberriesService } from './wildberries.service.js';

describe('WildberriesService', () => {
  const secret = 'test-secret-do-not-log';
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  const feedback = {
    id: 'review-1',
    text: 'Good product',
    pros: null,
    cons: '',
    productValuation: 5,
    createdDate: '2026-11-12T00:00:00Z',
    productDetails: { nmId: 123, productName: 'Test product' },
  };
  const page = {
    countUnanswered: 52,
    countArchive: 1000,
    feedbacks: [feedback],
  };
  let service: WildberriesService;
  let warnMock: MockInstance<Logger['warn']>;
  let errorMock: MockInstance<Logger['error']>;

  beforeEach(() => {
    fetchMock.mockReset();
    warnMock = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorMock = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    service = new WildberriesService(
      new HttpClient({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        headers: { Authorization: secret },
        timeout: 10_000,
        retry: false,
        fetch: fetchMock,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function expectFailure(
    status: number,
    operation: () => Promise<unknown> = () => service.listUnansweredFeedbacks(),
  ) {
    let caught: unknown;
    try {
      await operation();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    if (!(caught instanceof HttpException)) {
      throw new Error('Expected an HTTP exception');
    }

    expect(caught.getStatus()).toBe(status);
    expect(
      JSON.stringify({
        response: caught.getResponse(),
        warnings: warnMock.mock.calls,
        errors: errorMock.mock.calls,
      }),
    ).not.toContain(secret);
    return caught.getResponse();
  }

  it('returns validated reviews and requests the default unanswered page', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: false, data: page, errorText: secret }),
    );

    await expect(service.listUnansweredFeedbacks()).resolves.toEqual(page);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, options] = fetchMock.mock.calls[0]!;
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.origin).toBe('https://feedbacks-api.wildberries.ru');
    expect(url.pathname).toBe('/api/v1/feedbacks');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      isAnswered: 'false',
      take: '50',
      skip: '0',
      order: 'dateDesc',
    });
    expect(new Headers(options?.headers).get('Authorization')).toBe(secret);
    expect(warnMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it('accepts an empty page and forwards explicit pagination', async () => {
    const emptyPage = { ...page, feedbacks: [] };
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: false, data: emptyPage }),
    );

    await expect(
      service.listUnansweredFeedbacks({ take: 25, skip: 50 }),
    ).resolves.toEqual(emptyPage);
    const [input] = fetchMock.mock.calls[0]!;
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.searchParams.get('take')).toBe('25');
    expect(url.searchParams.get('skip')).toBe('50');
  });

  it.each([
    { take: 0 },
    { take: 101 },
    { take: 1.5 },
    { skip: -1 },
    { skip: 200_000 },
    { skip: 0.5 },
  ])(
    'rejects invalid pagination %j before making an upstream request',
    async (options) => {
      await expect(
        service.listUnansweredFeedbacks(options),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('accepts reviews with missing optional text and product details', async () => {
    const minimalPage = {
      ...page,
      feedbacks: [
        {
          id: feedback.id,
          productValuation: feedback.productValuation,
          createdDate: feedback.createdDate,
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: false, data: minimalPage }),
    );

    await expect(service.listUnansweredFeedbacks()).resolves.toEqual(
      minimalPage,
    );
  });

  it.each([
    ['WB application error', { error: true, data: null, errorText: secret }],
    ['missing data', { error: false, errorText: secret }],
    ['invalid count', { error: false, data: { ...page, countUnanswered: -1 } }],
    [
      'invalid review fields',
      {
        error: false,
        data: {
          ...page,
          feedbacks: [{ ...feedback, productValuation: secret }],
        },
      },
    ],
  ])('rejects %s without exposing response values', async (_name, body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));

    await expectFailure(502);
    expect(warnMock).toHaveBeenCalledExactlyOnceWith({
      operation: 'listUnansweredFeedbacks',
      code: 'WB_INVALID_RESPONSE',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: expect.any(Array),
          code: expect.any(String),
        }),
      ]),
    });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'maps upstream %i to a seller access error',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        Response.json(
          { detail: secret },
          { status, headers: { 'X-Private': secret } },
        ),
      );

      await expect(expectFailure(502)).resolves.toEqual({
        code: 'WB_ACCESS_DENIED',
        message: 'Check the Wildberries API key and its permissions',
      });
      expect(warnMock).toHaveBeenCalledExactlyOnceWith({
        operation: 'listUnansweredFeedbacks',
        code: 'WB_ACCESS_DENIED',
        upstreamStatus: status,
      });
      expect(errorMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['2', 2],
    ['0', 0],
    [' 12 ', 12],
    [null, undefined],
    ['', undefined],
    ['invalid', undefined],
    ['-1', undefined],
    ['1.5', undefined],
    ['1e3', undefined],
    ['9007199254740992', undefined],
  ])(
    'maps a rate limit with retry header %s safely',
    async (value, expected) => {
      const headers = new Headers({ 'X-Private': secret });
      if (value !== null) {
        headers.set('X-Ratelimit-Retry', value);
      }
      fetchMock.mockResolvedValueOnce(
        Response.json({ detail: secret }, { status: 429, headers }),
      );

      await expect(expectFailure(503)).resolves.toEqual({
        code: 'WB_RATE_LIMITED',
        message: 'Wildberries request limit reached',
        retryAfterSeconds: expected,
      });
      expect(warnMock).toHaveBeenCalledExactlyOnceWith({
        operation: 'listUnansweredFeedbacks',
        code: 'WB_RATE_LIMITED',
        upstreamStatus: 429,
        retryAfterSeconds: expected,
      });
      expect(errorMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([500, 503])(
    'maps upstream %i to 502 without exposing its body',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ detail: secret }, { status }),
      );

      await expectFailure(502);
      expect(warnMock).not.toHaveBeenCalled();
      expect(errorMock).toHaveBeenCalledTimes(1);
    },
  );

  it('maps malformed JSON to 502 without logging the raw body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`{"detail":"${secret}"`));

    await expectFailure(502);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to 502', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expectFailure(502);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it('maps an HTTP client timeout to 504', async () => {
    service = new WildberriesService(
      new HttpClient({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        timeout: 10,
        retry: false,
        fetch: fetchMock,
      }),
    );
    fetchMock.mockImplementationOnce(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );

    await expectFailure(504);
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submits the reply once and accepts an empty 204 response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      service.answerFeedback(feedback.id, { text: 'Thank you!' }),
    ).resolves.toEqual({ status: 'submitted' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, options] = fetchMock.mock.calls[0]!;
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.origin).toBe('https://feedbacks-api.wildberries.ru');
    expect(url.pathname).toBe('/api/v1/feedbacks/answer');
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('Authorization')).toBe(secret);
    expect(new Headers(options?.headers).get('Content-Type')).toContain('application/json');
    expect(options?.body).toBe(JSON.stringify({
      id: feedback.id,
      text: 'Thank you!',
    }));
  });

  it.each([
    [400, 400, 'WB_REPLY_REJECTED'],
    [401, 502, 'WB_ACCESS_DENIED'],
    [403, 502, 'WB_ACCESS_DENIED'],
    [500, 502, 'WB_SUBMISSION_UNKNOWN'],
    [503, 502, 'WB_SUBMISSION_UNKNOWN'],
  ])('handles reply HTTP %i without retrying', async (upstreamStatus, status, code) => {
    service = new WildberriesService(new HttpClient({
      baseUrl: 'https://feedbacks-api.wildberries.ru',
      headers: { Authorization: secret },
      retry: { attempts: 2, methods: ['POST'] },
      fetch: fetchMock,
    }));
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: secret }, { status: upstreamStatus }),
    );

    await expect(
      expectFailure(status, () => service.answerFeedback(feedback.id, { text: 'Thank you!' })),
    ).resolves.toMatchObject({ code });
    expect(warnMock).toHaveBeenCalledExactlyOnceWith({
      operation: 'answerFeedback',
      feedbackId: feedback.id,
      code,
      upstreamStatus,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['12', '0', 'invalid', '-1', '9007199254740992'])(
    'preserves safe reply cooldown metadata from %s',
    async (value) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ detail: secret }, {
          status: 429,
          headers: { 'X-Ratelimit-Retry': value },
        }),
      );

      const retryAfterSeconds = value === '12' || value === '0' ? Number(value) : undefined;
      const response = await expectFailure(503, () =>
        service.answerFeedback(feedback.id, { text: 'Thank you!' }),
      );
      expect(response).toMatchObject({
        code: 'WB_RATE_LIMITED',
        retryAfterSeconds,
      });
      expect(warnMock).toHaveBeenCalledExactlyOnceWith({
        operation: 'answerFeedback',
        feedbackId: feedback.id,
        code: 'WB_RATE_LIMITED',
        upstreamStatus: 429,
        retryAfterSeconds,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('leaves a lost reply response uncertain without resending', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      expectFailure(502, () => service.answerFeedback(feedback.id, { text: 'Thank you!' })),
    ).resolves.toMatchObject({ code: 'WB_SUBMISSION_UNKNOWN' });
    expect(warnMock).toHaveBeenCalledExactlyOnceWith({
      operation: 'answerFeedback',
      feedbackId: feedback.id,
      code: 'WB_SUBMISSION_UNKNOWN',
      upstreamStatus: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves a reply timeout uncertain without resending', async () => {
    service = new WildberriesService(new HttpClient({
      baseUrl: 'https://feedbacks-api.wildberries.ru',
      timeout: 10,
      retry: { attempts: 2, methods: ['POST'] },
      fetch: fetchMock,
    }));
    fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));

    await expect(
      expectFailure(502, () => service.answerFeedback(feedback.id, { text: 'Thank you!' })),
    ).resolves.toMatchObject({ code: 'WB_SUBMISSION_UNKNOWN' });
    expect(warnMock).toHaveBeenCalledExactlyOnceWith({
      operation: 'answerFeedback',
      feedbackId: feedback.id,
      code: 'WB_SUBMISSION_UNKNOWN',
      upstreamStatus: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves an unexpected success response uncertain', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: secret }));

    await expect(
      expectFailure(502, () => service.answerFeedback(feedback.id, { text: 'Thank you!' })),
    ).resolves.toMatchObject({ code: 'WB_SUBMISSION_UNKNOWN' });
    expect(warnMock).toHaveBeenCalledExactlyOnceWith({
      operation: 'answerFeedback',
      feedbackId: feedback.id,
      code: 'WB_SUBMISSION_UNKNOWN',
      upstreamStatus: 200,
    });
  });

  describe('getFeedbackForDraft', () => {
    it('forwards caller cancellation to the HTTP request and preserves the abort reason', async () => {
      const controller = new AbortController();
      const reason = new Error('Draft deadline expired');
      const started = Promise.withResolvers<AbortSignal>();
      fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
        const signal = options!.signal!;
        started.resolve(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      const failure = expect(
        service.getFeedbackForDraft(feedback.id, controller.signal),
      ).rejects.toBe(reason);
      const requestSignal = await started.promise;

      controller.abort(reason);
      await failure;

      expect(requestSignal.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warnMock).not.toHaveBeenCalled();
      expect(errorMock).not.toHaveBeenCalled();
    });

    it.each([
      null,
      { text: 'Thank you!', state: 'reviewRequired' },
      { text: 'Thank you!', state: 'rejected' },
    ])('returns validated review context and answer %j using one GET', async (answer) => {
      fetchMock.mockResolvedValueOnce(Response.json({
        error: false,
        data: {
          ...feedback,
          answer: answer && { ...answer, privateField: secret },
          productDetails: { ...feedback.productDetails, privateField: secret },
          privateField: secret,
        },
        errorText: secret,
      }));

      await expect(service.getFeedbackForDraft(` ${feedback.id} `))
        .resolves.toEqual({ ...feedback, answer });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, options] = fetchMock.mock.calls[0]!;
      const url = new URL(input instanceof Request ? input.url : input);
      expect(url.origin).toBe('https://feedbacks-api.wildberries.ru');
      expect(url.pathname).toBe('/api/v1/feedback');
      expect(Object.fromEntries(url.searchParams)).toEqual({ id: feedback.id });
      expect(options?.method).toBe('GET');
      expect(new Headers(options?.headers).get('Authorization')).toBe(secret);
      expect(warnMock).not.toHaveBeenCalled();
      expect(errorMock).not.toHaveBeenCalled();
    });

    it.each([
      {},
      { text: null, pros: null, cons: null, productDetails: null },
    ])('accepts absent or null optional review context: %j', async (optional) => {
      const review = {
        id: feedback.id,
        productValuation: feedback.productValuation,
        createdDate: feedback.createdDate,
        answer: null,
        ...optional,
      };
      fetchMock.mockResolvedValueOnce(Response.json({ error: false, data: review }));

      await expect(service.getFeedbackForDraft(feedback.id)).resolves.toEqual(review);
    });

    it.each(['', ' \n\t '])('rejects an invalid ID before fetching: %j', async (id) => {
      await expect(
        expectFailure(400, () => service.getFeedbackForDraft(id)),
      ).resolves.toMatchObject({ code: 'INVALID_FEEDBACK_ID' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      { error: true, data: null, errorText: secret },
      { error: false },
      { error: false, data: { ...feedback } },
      { error: false, data: { id: feedback.id, answer: null } },
      { error: false, data: { ...feedback, id: 'another-review', answer: null } },
      { error: false, data: { ...feedback, productValuation: secret, answer: null } },
      { error: false, data: { ...feedback, productDetails: { nmId: secret }, answer: null } },
      { error: false, data: { ...feedback, answer: { text: secret } } },
    ])('rejects an unsuccessful, malformed, or mismatched response: %#', async (body) => {
      fetchMock.mockResolvedValueOnce(Response.json(body));

      await expect(
        expectFailure(502, () => service.getFeedbackForDraft(feedback.id)),
      ).resolves.toMatchObject({ code: 'WB_INVALID_RESPONSE' });
      expect(warnMock).toHaveBeenCalledExactlyOnceWith({
        operation: 'getFeedbackForDraft',
        feedbackId: feedback.id,
        code: 'WB_INVALID_RESPONSE',
      });
      expect(errorMock).not.toHaveBeenCalled();
    });

    it.each([
      { upstreamStatus: 401, status: 502, code: 'WB_ACCESS_DENIED' },
      { upstreamStatus: 403, status: 502, code: 'WB_ACCESS_DENIED' },
      { upstreamStatus: 429, status: 503, code: 'WB_RATE_LIMITED' },
      { upstreamStatus: 500, status: 502, code: undefined },
    ])('maps upstream HTTP $upstreamStatus without retrying or exposing its body', async ({ upstreamStatus, status, code }) => {
      service = new WildberriesService(new HttpClient({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        retry: { attempts: 2, methods: ['GET'] },
        fetch: fetchMock,
      }));
      fetchMock.mockResolvedValueOnce(Response.json({ detail: secret }, {
        status: upstreamStatus,
        headers: { 'X-Ratelimit-Retry': '12' },
      }));

      const response = await expectFailure(status, () => service.getFeedbackForDraft(feedback.id));
      if (code) expect(response).toMatchObject({ code });
      if (upstreamStatus === 429) expect(response).toMatchObject({ retryAfterSeconds: 12 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('maps malformed JSON to 502 without exposing the raw body', async () => {
      fetchMock.mockResolvedValueOnce(new Response(`{"detail":"${secret}"`));

      await expectFailure(502, () => service.getFeedbackForDraft(feedback.id));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('maps a timeout to 504', async () => {
      service = new WildberriesService(new HttpClient({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        timeout: 10,
        retry: false,
        fetch: fetchMock,
      }));
      fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      }));

      await expectFailure(504, () => service.getFeedbackForDraft(feedback.id));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    null,
    { text: 'Thank you!', state: 'reviewRequired' },
    { text: 'Thank you!', state: 'rejected' },
  ])('reads the stored reply using GET without submitting anything', async (answer) => {
    const status = { id: feedback.id, answer };
    fetchMock.mockResolvedValueOnce(Response.json({
      error: false,
      data: { ...status, privateField: secret },
    }));

    await expect(service.getFeedbackAnswer(feedback.id)).resolves.toEqual(status);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, options] = fetchMock.mock.calls[0]!;
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.pathname).toBe('/api/v1/feedback');
    expect(url.searchParams.get('id')).toBe(feedback.id);
    expect(options?.method).toBe('GET');
  });

  it.each([
    { error: false, data: { id: feedback.id } },
    { error: false, data: { id: 'another-review', answer: null } },
    { error: false, data: { id: feedback.id, answer: { text: secret } } },
    { error: true, data: { id: feedback.id, answer: null }, errorText: secret },
  ])('keeps an invalid status response unverified', async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));

    await expect(
      expectFailure(502, () => service.getFeedbackAnswer(feedback.id)),
    ).resolves.toMatchObject({ code: 'WB_INVALID_RESPONSE' });
  });

  it.each([
    [401, 502, 'WB_ACCESS_DENIED'],
    [403, 502, 'WB_ACCESS_DENIED'],
    [429, 503, 'WB_RATE_LIMITED'],
  ])('preserves status-check HTTP %i failures', async (upstreamStatus, status, code) => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: secret }, {
      status: upstreamStatus,
      headers: { 'X-Ratelimit-Retry': '12' },
    }));

    await expect(
      expectFailure(status, () => service.getFeedbackAnswer(feedback.id)),
    ).resolves.toMatchObject({ code });
    expect(warnMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      operation: 'getFeedbackAnswer',
      feedbackId: feedback.id,
      code,
      upstreamStatus,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
