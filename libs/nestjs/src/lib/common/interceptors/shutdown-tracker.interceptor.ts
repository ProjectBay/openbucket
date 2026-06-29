import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';

import { ShutdownState } from '../shutdown-state.service';

@Injectable()
export class ShutdownTrackerInterceptor implements NestInterceptor {
  constructor(private readonly state: ShutdownState) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    this.state.enter();
    return next.handle().pipe(finalize(() => this.state.leave()));
  }
}
