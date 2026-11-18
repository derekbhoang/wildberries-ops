import { createOpenAI } from '@ai-sdk/openai';
import { AiModule } from '@nestjs/ai';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WildberriesModule } from '../wildberries/wildberries.module.js';
import { FeedbackDraftsController } from './feedback-drafts.controller.js';
import { FeedbackDraftsService } from './feedback-drafts.service.js';
import { ReviewReplyGeneratorService } from './review-reply-generator.service.js';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    WildberriesModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 10 }],
      getTracker: () => 'configured-seller',
    }),
    AiModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const openai = createOpenAI({
          apiKey: config.getOrThrow<string>('OPENAI_API_KEY'),
        });

        return {
          models: {
            reviewReply: openai(
              config.getOrThrow<string>('OPENAI_REPLY_MODEL'),
            ),
          },
          defaults: {
            timeout: '15s',
            retry: false,
            maxOutputTokens: 1000,
          },
          include: [],
        };
      },
    }),
  ],
  controllers: [FeedbackDraftsController],
  providers: [FeedbackDraftsService, ReviewReplyGeneratorService],
})
export class FeedbackDraftsModule {}
