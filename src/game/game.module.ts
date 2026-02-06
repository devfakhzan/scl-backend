import { Module } from '@nestjs/common'
import { GameController } from './game.controller'
import { GameService } from './game.service'
import { WeeklyResetService } from './weekly-reset.service'
import { PrismaService } from '../prisma/prisma.service'
import { MetricsService } from '../metrics/metrics.service'
import { GameStateGuard } from './guards/game-state.guard'

@Module({
  controllers: [GameController],
  providers: [GameService, WeeklyResetService, PrismaService, GameStateGuard],
  exports: [GameService, PrismaService],
})
export class GameModule {}
