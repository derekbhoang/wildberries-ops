import {
  Controller,
  Get,
  Query,
  StandardSchemaValidationPipe,
  UsePipes,
} from '@nestjs/common';
import {
  feedbacksQuerySchema,
  type FeedbacksQuery,
} from './feedbacks-query.schema.js';
import type { FeedbacksPage } from './wildberries.schemas.js';
import { WildberriesService } from './wildberries.service.js';

@Controller('feedbacks')
@UsePipes(new StandardSchemaValidationPipe())
export class FeedbacksController {
  constructor(
    private readonly wildberries: WildberriesService,
  ) {}

  @Get()
  list(
    @Query({ schema: feedbacksQuerySchema })
    query: FeedbacksQuery,
  ): Promise<FeedbacksPage> {
    return this.wildberries.listUnansweredFeedbacks(query);
  }
}
