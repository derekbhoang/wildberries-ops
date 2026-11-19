import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ResilienceTimeoutError, TimeoutPolicy } from '@nestjs/resilience';
import {
  feedbackAnswerSchema,
  feedbackIdSchema,
  type FeedbackDraft,
} from '@wildberries-ops/contracts';
import { WildberriesService } from '../wildberries/wildberries.service.js';
import { ReviewReplyGeneratorService } from './review-reply-generator.service.js';

@Injectable()
export class FeedbackDraftsService {
  private readonly logger = new Logger(FeedbackDraftsService.name);
  private readonly deadline = new TimeoutPolicy({
    timeout: '25s',
    name: 'feedback-draft',
  });

  constructor(
    private readonly wildberries: WildberriesService,
    private readonly generator: ReviewReplyGeneratorService,
  ) {}

  async generate(feedbackId: string): Promise<FeedbackDraft> {
    try {
      return await this.deadline.execute(({ signal }) =>
        this.generateWithinDeadline(feedbackId, signal),
      );
    } catch (error) {
      // Preserve existing Wildberries and AI exceptions.
      if (!(error instanceof ResilienceTimeoutError)) throw error;

      this.logger.warn({
        operation: 'generateFeedbackDraft',
        code: 'DRAFT_TIMEOUT',
      });

      throw new GatewayTimeoutException({
        code: 'DRAFT_TIMEOUT',
        message: 'Generating a reply took too long. Try generating again.',
      });
    }
  }

  private async generateWithinDeadline(
    feedbackId: string,
    signal: AbortSignal,
  ): Promise<FeedbackDraft> {
    const parsedId = feedbackIdSchema.safeParse(feedbackId);

    if (!parsedId.success) {
      throw new BadRequestException({
        code: 'INVALID_FEEDBACK_ID',
        message: 'The review ID is missing or invalid',
      });
    }

    const id = parsedId.data;
    const feedback = await this.wildberries.getFeedbackForDraft(id, signal);

    if (feedback.id !== id) {
      this.logger.warn({
        operation: 'generateFeedbackDraft',
        feedbackId,
        code: 'WB_INVALID_RESPONSE',
      });

      throw new BadGatewayException({
        code: 'WB_INVALID_RESPONSE',
        message: 'Could not verify the requested review',
      });
    }

    if (feedback.answer !== null) {
      throw new ConflictException({
        code: 'FEEDBACK_ALREADY_ANSWERED',
        message: 'A reply already exists for this review',
      });
    }

    const status = feedback.orderStatus?.trim();
    const orderStatus =
      status === 'buyout' || status === 'rejected' || status === 'returned'
        ? status
        : null;

    const generated = await this.generator.generate(
      {
        review: {
          text: feedback.text?.trim() || null,
          pros: feedback.pros?.trim() || null,
          cons: feedback.cons?.trim() || null,
          rating: feedback.productValuation,
          userName: feedback.userName?.trim() || null,
        },
        product: feedback.productDetails
          ? {
              nmId: feedback.productDetails.nmId,
              name: feedback.productDetails.productName?.trim() || null,
              size: feedback.productDetails.size?.trim() || null,
            }
          : null,
        orderStatus,
      },
      signal,
    );

    const parsedDraft = feedbackAnswerSchema.safeParse(generated);

    if (!parsedDraft.success) {
      this.logger.warn({
        operation: 'generateFeedbackDraft',
        feedbackId,
        code: 'AI_INVALID_RESPONSE',
      });

      throw new BadGatewayException({
        code: 'AI_INVALID_RESPONSE',
        message: 'AI returned an invalid reply draft. Try generating again.',
      });
    }

    return {
      feedbackId: id,
      text: parsedDraft.data.text,
    };
  }
}
