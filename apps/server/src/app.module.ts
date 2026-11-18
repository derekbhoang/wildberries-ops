import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.validation.js';
import { WildberriesModule } from './wildberries/wildberries.module.js';
import { FeedbackDraftsModule } from './feedback-drafts/feedback-drafts.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      skipProcessEnv: true,
      validationSchema: envSchema,
    }),
    WildberriesModule,
    FeedbackDraftsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
