import { Controller, Get } from '@nestjs/common'
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus'
import { PrismaService } from '../prisma/prisma.service'

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      async () => {
        // Check Prisma database connection
        await this.prisma.$queryRaw`SELECT 1`
        return { database: { status: 'up' } }
      },
      // Memory checks with more realistic thresholds for production workloads
      // Heap: 500MB (Node.js apps typically use 200-400MB under normal load)
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
      // RSS: 1GB (total memory including heap, stack, and code)
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ])
  }
}
