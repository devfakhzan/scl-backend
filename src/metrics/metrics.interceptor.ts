import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap, catchError } from 'rxjs/operators'
import { MetricsService } from './metrics.service'

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const response = context.switchToHttp().getResponse()
    const { method, route } = request
    const routePath = route?.path || request.url

    const startTime = Date.now()

    return next.handle().pipe(
      tap(() => {
        const duration = (Date.now() - startTime) / 1000
        const statusCode = response.statusCode

        // Record request duration
        this.metricsService.httpRequestDuration.observe(
          {
            method,
            route: routePath,
            status_code: statusCode.toString(),
          },
          duration,
        )

        // Record total requests
        this.metricsService.httpRequestTotal.inc({
          method,
          route: routePath,
          status_code: statusCode.toString(),
        })

        // Record errors (4xx, 5xx)
        // Exclude 429 (Too Many Requests) - this is expected business logic for rate limiting
        if (statusCode >= 400 && statusCode !== 429) {
          const errorType = statusCode >= 500 ? 'server_error' : 'client_error'
          this.metricsService.httpRequestErrors.inc({
            method,
            route: routePath,
            error_type: errorType,
          })
        }
      }),
      catchError((error) => {
        const duration = (Date.now() - startTime) / 1000
        const statusCode = error.status || 500

        // Record error metrics
        this.metricsService.httpRequestDuration.observe(
          {
            method,
            route: routePath,
            status_code: statusCode.toString(),
          },
          duration,
        )

        this.metricsService.httpRequestTotal.inc({
          method,
          route: routePath,
          status_code: statusCode.toString(),
        })

        // Don't count 429 (Too Many Requests) as an error - it's expected business logic
        if (statusCode !== 429) {
          this.metricsService.httpRequestErrors.inc({
            method,
            route: routePath,
            error_type: 'exception',
          })
        }

        throw error
      }),
    )
  }
}
