import { Module, Global } from '@nestjs/common';
import { SseEventBus } from './sse-event-bus';

@Global()
@Module({
  providers: [SseEventBus],
  exports: [SseEventBus],
})
export class EventsModule {}
