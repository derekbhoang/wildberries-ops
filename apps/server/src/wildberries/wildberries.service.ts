import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HttpClient,
  HttpClientError,
  HttpResponseError,
  InjectHttpClient,
  toHttpException,
} from '@nestjs/http-client';
import {
  feedbackAnswerResponseSchema,
  feedbackForDraftResponseSchema,
  feedbacksResponseSchema,
  type FeedbackForDraft,
  type FeedbacksPage,
} from './wildberries.schemas.js';
import {
  feedbackIdSchema,
  type FeedbackAnswer,
  type FeedbackAnswerResult,
  type FeedbackAnswerStatus,
} from '@wildberries-ops/contracts';

const FEEDBACK_LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

@Injectable()
export class WildberriesService {
  private readonly logger = new Logger(WildberriesService.name);

  constructor(
    @InjectHttpClient('wbFeedbacks')
    private readonly http: HttpClient,
  ) {}

  async listUnansweredFeedbacks({
    take = 50,
    skip = 0,
  }: { take?: number; skip?: number } = {}): Promise<FeedbacksPage> {
    if (
      !Number.isInteger(take) ||
      take < 1 ||
      take > 100 ||
      !Number.isInteger(skip) ||
      skip < 0 ||
      skip > 199_990
    ) {
      throw new BadRequestException('Invalid review pagination');
    }

    const dateTo = Math.floor(Date.now() / 1_000);
    const dateFrom = dateTo - FEEDBACK_LOOKBACK_SECONDS;

    try {
      const { data: body } = await this.http.get<unknown>('/api/v1/feedbacks', {
        responseType: 'json',
        query: {
          isAnswered: false,
          take,
          skip,
          order: 'dateDesc',
          dateFrom,
          dateTo,
        },
      });

      const parsed = feedbacksResponseSchema.safeParse(body);

      if (!parsed.success) {
        this.logger.warn({
          operation: 'listUnansweredFeedbacks',
          code: 'WB_INVALID_RESPONSE',
          issues: parsed.error.issues.map(({ path, code }) => ({ path, code })),
        });
        throw new BadGatewayException(
          'Wildberries returned an invalid or unsuccessful response',
        );
      }

      return parsed.data.data;
    } catch (error) {
      this.throwAccessOrRateLimitError(error, {
        operation: 'listUnansweredFeedbacks',
      });
      throw toHttpException(error);
    }
  }

  async answerFeedback(
    id: string,
    body: FeedbackAnswer,
  ): Promise<FeedbackAnswerResult> {
    try {
      const response = await this.http.post('/api/v1/feedbacks/answer', {
        json: { id, text: body.text },
        responseType: 'text',
        retry: false,
      });

      if (response.status !== 204) {
        this.logger.warn({
          operation: 'answerFeedback',
          feedbackId: id,
          code: 'WB_SUBMISSION_UNKNOWN',
          upstreamStatus: response.status,
        });
        throw new BadGatewayException({
          code: 'WB_SUBMISSION_UNKNOWN',
          message: 'Could not confirm whether Wildberries accepted the reply',
        });
      }

      return { status: 'submitted' };
    } catch (error) {
      this.throwAccessOrRateLimitError(error, {
        operation: 'answerFeedback',
        feedbackId: id,
      });
      if (error instanceof HttpResponseError && error.status === 400) {
        this.logger.warn({
          operation: 'answerFeedback',
          feedbackId: id,
          code: 'WB_REPLY_REJECTED',
          upstreamStatus: error.status,
        });
        throw new BadRequestException({
          code: 'WB_REPLY_REJECTED',
          message: 'Wildberries rejected the reply',
        });
      }

      if (error instanceof HttpClientError) {
        this.logger.warn({
          operation: 'answerFeedback',
          feedbackId: id,
          code: 'WB_SUBMISSION_UNKNOWN',
          upstreamStatus:
            error instanceof HttpResponseError ? error.status : undefined,
        });

        throw new BadGatewayException({
          code: 'WB_SUBMISSION_UNKNOWN',
          message: 'Check the review before attempting to send the reply again',
        });
      }

      throw error;
    }
  }

  async getFeedbackAnswer(id: string): Promise<FeedbackAnswerStatus> {
    try {
      const { data: body } = await this.http.get<unknown>('/api/v1/feedback', {
        query: { id },
        responseType: 'json',
        retry: false,
      });
      const parsed = feedbackAnswerResponseSchema.safeParse(body);

      if (!parsed.success || parsed.data.data.id !== id) {
        this.logger.warn({
          operation: 'getFeedbackAnswer',
          feedbackId: id,
          code: 'WB_INVALID_RESPONSE',
        });
        throw new BadGatewayException({
          code: 'WB_INVALID_RESPONSE',
          message: 'Could not read the reply status from Wildberries',
        });
      }

      return parsed.data.data;
    } catch (error) {
      this.throwAccessOrRateLimitError(error, {
        operation: 'getFeedbackAnswer',
        feedbackId: id,
      });
      throw toHttpException(error);
    }
  }

  async getFeedbackForDraft(
    id: string,
    signal?: AbortSignal,
  ): Promise<FeedbackForDraft> {
    const parsedId = feedbackIdSchema.safeParse(id);
    if (!parsedId.success) {
      throw new BadRequestException({
        code: 'INVALID_FEEDBACK_ID',
        message: 'The review ID is missing or invalid',
      });
    }

    const feedbackId = parsedId.data;

    try {
      const { data: body } = await this.http.get<unknown>('/api/v1/feedback', {
        query: { id: feedbackId },
        responseType: 'json',
        retry: false,
        signal,
      });
      const parsed = feedbackForDraftResponseSchema.safeParse(body);

      if (!parsed.success || parsed.data.data.id !== feedbackId) {
        this.logger.warn({
          operation: 'getFeedbackForDraft',
          feedbackId,
          code: 'WB_INVALID_RESPONSE',
        });
        throw new BadGatewayException({
          code: 'WB_INVALID_RESPONSE',
          message: 'Could not read the requested review from Wildberries',
        });
      }

      return parsed.data.data;
    } catch (error) {
      signal?.throwIfAborted();
      this.throwAccessOrRateLimitError(error, {
        operation: 'getFeedbackForDraft',
        feedbackId,
      });
      throw toHttpException(error);
    }
  }

  private throwAccessOrRateLimitError(
    error: unknown,
    context: { operation: string; feedbackId?: string },
  ): void {
    if (!(error instanceof HttpResponseError)) return;

    if (error.status === 401 || error.status === 403) {
      this.logger.warn({
        ...context,
        code: 'WB_ACCESS_DENIED',
        upstreamStatus: error.status,
      });
      throw new BadGatewayException({
        code: 'WB_ACCESS_DENIED',
        message: 'Check the Wildberries API key and its permissions',
      });
    }

    if (error.status === 429) {
      const value = error.headers.get('X-Ratelimit-Retry')?.trim() ?? '';
      const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN;
      const retryAfterSeconds = Number.isSafeInteger(seconds)
        ? seconds
        : undefined;

      this.logger.warn({
        ...context,
        code: 'WB_RATE_LIMITED',
        upstreamStatus: error.status,
        retryAfterSeconds,
      });
      throw new ServiceUnavailableException({
        code: 'WB_RATE_LIMITED',
        message: 'Wildberries request limit reached',
        retryAfterSeconds,
      });
    }
  }
}
