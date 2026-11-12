import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpClientModule } from '@nestjs/http-client';
import { WildberriesService } from './wildberries.service.js';
import { FeedbacksController } from './feedbacks.controller.js';

@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: 'wbFeedbacks',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseUrl: 'https://feedbacks-api.wildberries.ru',
        headers: {
          Authorization: config.getOrThrow<string>('WB_API_KEY'),
        },
        timeout: 10_000,
        retry: false,
      }),
    }),
  ],
  controllers: [FeedbacksController],
  providers: [WildberriesService],
  exports: [WildberriesService],
})
export class WildberriesModule {}
