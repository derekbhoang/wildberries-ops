import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StandardSchemaValidationPipe,
  UsePipes,
} from '@nestjs/common';
import {
  feedbackAnswerSchema,
  feedbackIdSchema,
  type FeedbackAnswer,
  type FeedbackAnswerResult,
  type FeedbackAnswerStatus,
} from '@wildberries-ops/contracts';
import {
  feedbacksQuerySchema,
  type FeedbacksQuery,
} from './feedbacks-query.schema.js';
import type { FeedbacksPage } from './wildberries.schemas.js';
import { WildberriesService } from './wildberries.service.js';

@Controller('feedbacks')
@UsePipes(new StandardSchemaValidationPipe())
export class FeedbacksController {
  constructor(private readonly wildberries: WildberriesService) {}

  @Get()
  list(
    @Query({ schema: feedbacksQuerySchema }) query: FeedbacksQuery,
  ): Promise<FeedbacksPage> {
    return this.wildberries.listUnansweredFeedbacks(query);
  }

  @Post(':id/answer')
  @HttpCode(HttpStatus.OK)
  answer(
    @Param('id', { schema: feedbackIdSchema }) id: string,
    @Body({ schema: feedbackAnswerSchema }) body: FeedbackAnswer,
  ): Promise<FeedbackAnswerResult> {
    return this.wildberries.answerFeedback(id, body);
  }

  @Get(':id/answer')
  @Header('Cache-Control', 'no-store')
  answerStatus(
    @Param('id', { schema: feedbackIdSchema }) id: string,
  ): Promise<FeedbackAnswerStatus> {
    return this.wildberries.getFeedbackAnswer(id);
  }
}
