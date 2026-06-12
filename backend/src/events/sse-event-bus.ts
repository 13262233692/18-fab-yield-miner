import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ScratchAlertEvent {
  type: 'scratch_detected';
  taskId: string;
  batchId: string;
  waferId: string;
  severity: 'CRITICAL' | 'WARNING' | 'MILD';
  scratchCount: number;
  criticalCount: number;
  warningCount: number;
  timestamp: number;
}

export interface TaskProgressEvent {
  type: 'progress';
  taskId: string;
  batchId: string;
  phase: string;
  percent: number;
  message: string;
  waferIndex?: number;
  totalWafers?: number;
  currentWaferId?: string;
}

export type SseEvent = ScratchAlertEvent | TaskProgressEvent;

@Injectable()
export class SseEventBus {
  private readonly eventSubject = new Subject<SseEvent>();
  private readonly subscribers = new Map<string, Set<number>>();
  private idCounter = 0;

  emit(event: SseEvent) {
    this.eventSubject.next(event);
  }

  subscribe(taskId?: string) {
    const id = ++this.idCounter;
    if (taskId) {
      if (!this.subscribers.has(taskId)) {
        this.subscribers.set(taskId, new Set());
      }
      this.subscribers.get(taskId)!.add(id);
    }

    return this.eventSubject
      .asObservable()
      .pipe(
        map((event) => ({
          id: String(id),
          type: event.type,
          data: JSON.stringify(event),
        }))
      );
  }

  unsubscribe(taskId: string, subscriberId: number) {
    const subs = this.subscribers.get(taskId);
    if (subs) {
      subs.delete(subscriberId);
      if (subs.size === 0) {
        this.subscribers.delete(taskId);
      }
    }
  }

  hasActiveSubscribers(taskId: string): boolean {
    return (this.subscribers.get(taskId)?.size || 0) > 0;
  }
}
