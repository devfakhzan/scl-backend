import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService, PrismaClient } from '../prisma/prisma.service'
import { GameService } from './game.service'

type GameSettings = Awaited<ReturnType<PrismaClient['gameSettings']['findUnique']>>

@Injectable()
export class WeeklyResetService implements OnModuleInit {
  private readonly logger = new Logger(WeeklyResetService.name)
  private readonly prisma: PrismaClient

  constructor(
    prismaService: PrismaService,
    private gameService: GameService,
  ) {
    this.prisma = prismaService
  }

  async onModuleInit() {
    // Check if weekly reset is enabled and perform initial check
    const settings = await this.gameService.getSettings()
    if (settings.weeklyResetEnabled) {
      this.logger.log('Weekly reset is enabled. Checking if reset is needed...')
      await this.checkAndPerformReset()
    } else {
      this.logger.log('Weekly reset is disabled.')
    }
  }

  /**
   * Calculate the duration of a "week" in milliseconds.
   * In production, this is 7 real days.
   * In debug mode (secondsPerDay set), this is 7 virtual days.
   */
  private getWeekDurationMs(settings: GameSettings): number {
    const dayMs = this.getDayDurationMs(settings)
    return dayMs * 7 // 7 days = 1 week
  }

  /**
   * Get the duration of a "game day" in milliseconds.
   */
  private getDayDurationMs(settings: GameSettings): number {
    const secondsPerDay = settings.secondsPerDay && settings.secondsPerDay > 0 ? settings.secondsPerDay : 86400
    return secondsPerDay * 1000
  }

  /**
   * Calculate the current week number based on launch date.
   * Week 0 is the first week (launch week).
   * In debug mode, uses virtual weeks based on secondsPerDay.
   */
  private calculateCurrentWeekNumber(settings: GameSettings): number {
    const nowMs = Date.now()
    const now = new Date(nowMs)
    const launchDate = new Date(settings.launchDate)
    // Use UTC methods to avoid timezone issues
    launchDate.setUTCHours(0, 0, 0, 0)
    
    if (settings.secondsPerDay && settings.secondsPerDay > 0) {
      // Debug mode: Use virtual weeks
      const dayMs = this.getDayDurationMs(settings)
      const launchMs = launchDate.getTime()
      const daysSinceLaunch = Math.floor((nowMs - launchMs) / dayMs)
      return Math.floor(daysSinceLaunch / 7)
    } else {
      // Production mode: Use real calendar weeks
      const resetDay = settings.weeklyResetDay ?? 0 // 0 = Sunday, 1 = Monday, etc.
      
      // Find the start of the current week (based on resetDay)
      // Use UTC methods to avoid timezone issues
      const currentDay = now.getUTCDay()
      const currentHour = now.getUTCHours()
      let daysToSubtract = (currentDay - resetDay + 7) % 7
      if (daysToSubtract === 0 && currentHour < 1) {
        // If it's the reset day but before 1 AM UTC, go back to previous week
        daysToSubtract = 7
      }
      
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - daysToSubtract)
      weekStart.setUTCHours(0, 0, 0, 0)
      
      // Calculate week number: weeks since launch week
      const weekMs = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
      const weeksSinceLaunch = Math.floor((weekStart.getTime() - launchDate.getTime()) / weekMs)
      
      return Math.max(0, weeksSinceLaunch)
    }
  }

  /**
   * Check if a reset is needed and perform it if so.
   * Uses week numbers for simple comparison.
   */
  async checkAndPerformReset(): Promise<void> {
    const settings = await this.gameService.getSettings()
    
    if (!settings.weeklyResetEnabled) {
      return
    }

    const currentWeekNumber = this.calculateCurrentWeekNumber(settings)
    const storedWeekNumber = settings.currentWeekNumber

    // If week hasn't changed, no reset needed
    if (storedWeekNumber !== null && storedWeekNumber >= currentWeekNumber) {
      this.logger.debug(`No reset needed. Current week: ${currentWeekNumber}, Stored week: ${storedWeekNumber}`)
      return
    }

    this.logger.log(`Week changed from ${storedWeekNumber ?? 'null'} to ${currentWeekNumber}. Performing reset...`)

    // Update the stored week number first
    await this.prisma.gameSettings.update({
      where: { id: 1 },
      data: { currentWeekNumber },
    })

    // Get all players that need a reset (those with lastResetWeekNumber < currentWeekNumber or null)
    const players = await this.prisma.player.findMany({
      where: {
        OR: [
          { lastResetWeekNumber: null },
          { lastResetWeekNumber: { lt: currentWeekNumber } },
        ],
      },
    })

    if (players.length === 0) {
      this.logger.debug('No players need weekly reset.')
      return
    }

    this.logger.log(`Performing weekly reset for ${players.length} players...`)

    // Create snapshots before resetting
    const snapshots = players.map(player => ({
      weekNumber: currentWeekNumber,
      playerId: player.id,
      walletAddress: player.walletAddress,
      weeklyScore: player.weeklyScore ?? 0,
      weeklyStreak: player.weeklyStreak ?? 0,
      weeklyLongestStreak: player.weeklyLongestStreak ?? 0,
      lifetimeTotalScore: (player.lifetimeTotalScore ?? 0) + (player.weeklyScore ?? 0),
    }))

    // Save snapshots in batch
    if (snapshots.length > 0) {
      await this.prisma.weeklyScoreSnapshot.createMany({
        data: snapshots,
      })
      this.logger.log(`Created ${snapshots.length} weekly score snapshots for week ${currentWeekNumber}`)
    }

    // Reset all players in a single transaction
    for (const player of players) {
      // Preserve lifetime score before resetting
      const lifetimeTotalScore = (player.lifetimeTotalScore ?? 0) + (player.weeklyScore ?? 0)
      
      await this.prisma.player.update({
        where: { id: player.id },
        data: {
          lifetimeTotalScore,
          weeklyScore: 0,
          weeklyStreak: 0,
          weeklyLongestStreak: 0,
          lastResetWeekNumber: currentWeekNumber,
        },
      })
    }

    // Invalidate leaderboard cache (we'll rely on TTL expiration)
    this.logger.log(`Weekly reset completed for ${players.length} players. Week ${currentWeekNumber} started.`)
  }

  /**
   * Cron job that runs every hour to check if weekly reset is needed.
   * In debug mode with secondsPerDay, this will trigger more frequently.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleWeeklyResetCron() {
    const settings = await this.gameService.getSettings()
    
    if (!settings.weeklyResetEnabled) {
      return
    }

    this.logger.debug('Checking for weekly reset...')
    await this.checkAndPerformReset()
  }

  /**
   * Manual trigger for testing purposes.
   */
  async triggerReset(): Promise<void> {
    this.logger.log('Manual weekly reset triggered')
    await this.checkAndPerformReset()
  }
}
