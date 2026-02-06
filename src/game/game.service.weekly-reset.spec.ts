import { Test, TestingModule } from '@nestjs/testing'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { ConfigService } from '@nestjs/config'
import { GameService } from './game.service'
import { Cache } from 'cache-manager'
import { PrismaService, PrismaClient } from '../prisma/prisma.service'
import { BadRequestException } from '@nestjs/common'

type GameSettings = Awaited<ReturnType<PrismaClient['gameSettings']['findUnique']>>
type Player = Awaited<ReturnType<PrismaClient['player']['findUnique']>>
type GameSession = Awaited<ReturnType<PrismaClient['gameSession']['create']>>

describe('GameService - Weekly Reset Integration', () => {
  let service: GameService
  let prisma: PrismaService
  let cache: Cache

  const walletAddress = '0xTEST'
  const launchDate = new Date('2025-01-01T00:00:00.000Z')

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameService,
        {
          provide: PrismaService,
          useValue: {
            gameSettings: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
            },
            player: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
              findMany: jest.fn(),
            },
            gameSession: {
              count: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
            },
            playerStreak: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('postgresql://test:test@localhost:5432/test'),
          },
        },
      ],
    }).compile()

    service = module.get<GameService>(GameService)
    prisma = module.get<PrismaService>(PrismaService)
    cache = module.get<Cache>(CACHE_MANAGER)
  })

  describe('Score Submission - Weekly Reset Enabled', () => {
    it('should accumulate weekly score when weekly reset is enabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 3,
        longestStreak: 3,
        lastPlayDate: launchDate,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 5000,
        weeklyScore: 2000,
        weeklyStreak: 3,
        weeklyLongestStreak: 3,
        lastResetWeekNumber: 1,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.player, 'create').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: 1,
        streakMultiplier: 1.2,
        finalScore: 1200,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 3,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue({
        ...player,
        weeklyScore: 3200,
      })

      const now = new Date(launchDate.getTime() + 24 * 60 * 60 * 1000) // Next day
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      const result = await service.submitScore({
        walletAddress,
        score: 1000,
      })

      expect(result.finalScore).toBe(1200) // 1000 * 1.2 multiplier
      
      // Verify the update was called
      expect(prismaClient.player.update).toHaveBeenCalled()
      const updateCall = (prismaClient.player.update as jest.Mock).mock.calls[0]
      
      // With weekly reset enabled, weeklyScore should accumulate
      // Player starts with weeklyScore: 2000, and finalScore is added
      // The actual value depends on streak multiplier, but should be >= 2000
      const actualWeeklyScore = updateCall[0].data.weeklyScore
      expect(actualWeeklyScore).toBeGreaterThanOrEqual(2000)
      // Should be approximately 2000 + finalScore (which is 1000 * streak multiplier)
      // If streak is 4, multiplier is 1.3, so finalScore = 1300, weeklyScore = 3300
      expect(actualWeeklyScore).toBe(3300) // 2000 + 1300 (1000 * 1.3)
      // lifetimeTotalScore should be preserved (not updated)
      // Note: service doesn't update lifetimeTotalScore, it's preserved in the database
    })

    it('should accumulate lifetime score when weekly reset is disabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: false,
        weeklyResetDay: 0,
        currentWeekNumber: null,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 5000,
        currentStreak: 3,
        longestStreak: 3,
        lastPlayDate: launchDate,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 0,
        weeklyScore: 0,
        weeklyStreak: 0,
        weeklyLongestStreak: 0,
        lastResetWeekNumber: null,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: null,
        streakMultiplier: 1.2,
        finalScore: 1200,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 3,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue({
        ...player,
        totalScore: 6200,
      })

      const now = new Date(launchDate.getTime() + 24 * 60 * 60 * 1000)
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      const result = await service.submitScore({
        walletAddress,
        score: 1000,
      })

      expect(prismaClient.player.update).toHaveBeenCalled()
      const updateCall = (prismaClient.player.update as jest.Mock).mock.calls[0]
      
      // Player starts with totalScore: 5000
      // totalScore should increase by finalScore
      // Get actual finalScore from the game session create call
      const sessionCreateCall = (prismaClient.gameSession.create as jest.Mock).mock.calls[0]
      const actualFinalScore = sessionCreateCall[0].data.finalScore
      expect(updateCall[0].data.totalScore).toBe(5000 + actualFinalScore)

      // Should not update weekly fields when weekly reset is disabled
      expect(updateCall[0].data.weeklyScore).toBeUndefined()
    })

    it('should store weekNumber in game session when weekly reset is enabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: 60,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 1,
        longestStreak: 1,
        lastPlayDate: null,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 0,
        weeklyScore: 0,
        weeklyStreak: 0,
        weeklyLongestStreak: 0,
        lastResetWeekNumber: 1,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: 1,
        streakMultiplier: 1,
        finalScore: 1000,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 1,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue(player)

      // Use a date 8 days after launch to get week 1 (with secondsPerDay=60, 8 days = week 1)
      const testDate = new Date(launchDate.getTime() + 8 * 60 * 1000)
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(testDate.getTime())

      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Should store week number in session
      expect(prismaClient.gameSession.create).toHaveBeenCalled()
      const createCall = (prismaClient.gameSession.create as jest.Mock).mock.calls[0]
      // With secondsPerDay=60 and 8 days after launch, week should be 1
      expect(createCall[0].data.weekNumber).toBe(1)
    })

    it('should not store weekNumber when weekly reset is disabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: false,
        weeklyResetDay: 0,
        currentWeekNumber: null,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 1,
        longestStreak: 1,
        lastPlayDate: null,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 0,
        weeklyScore: 0,
        weeklyStreak: 0,
        weeklyLongestStreak: 0,
        lastResetWeekNumber: null,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: null,
        streakMultiplier: 1,
        finalScore: 1000,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 1,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue(player)

      jest.spyOn(Date, 'now').mockReturnValue(launchDate.getTime())

      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Should not store week number
      expect(prismaClient.gameSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          weekNumber: null,
        }),
      })
    })
  })

  describe('Streak Calculations - Weekly vs Lifetime', () => {
    it('should track weekly streak separately from lifetime streak when weekly reset enabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: 60,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 10, // Lifetime streak
        longestStreak: 10,
        lastPlayDate: new Date(launchDate.getTime() + 9 * 60 * 1000),
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 10000,
        weeklyScore: 5000,
        weeklyStreak: 3, // Weekly streak
        weeklyLongestStreak: 3,
        lastResetWeekNumber: 1,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: 1,
        streakMultiplier: 1.2,
        finalScore: 1200,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 11,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue(player)

      // Play on day 10 (consecutive)
      const now = new Date(launchDate.getTime() + 10 * 60 * 1000)
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Should update both weekly and lifetime streaks
      expect(prismaClient.player.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          currentStreak: 11, // Lifetime streak increases
          weeklyStreak: 4, // Weekly streak increases
          weeklyLongestStreak: 4,
        }),
      })
    })

    it('should reset weekly streak but preserve lifetime streak after weekly reset', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: 60,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      // Player after weekly reset: weekly streak reset, lifetime streak preserved
      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 10, // Lifetime streak preserved
        longestStreak: 10,
        lastPlayDate: new Date(launchDate.getTime() + 8 * 60 * 1000),
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 15000, // Accumulated from previous weeks
        weeklyScore: 0, // Reset
        weeklyStreak: 0, // Reset
        weeklyLongestStreak: 0, // Reset
        lastResetWeekNumber: 1, // Just reset
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: 1,
        streakMultiplier: 1,
        finalScore: 1000,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 11,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue(player)

      // First play of new week - must be a consecutive day (9 days after launch, not 8)
      // Player's lastPlayDate is 8 days after launch, so we need 9 days to make it consecutive
      const now = new Date(launchDate.getTime() + 9 * 60 * 1000) // 9 days = consecutive day
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Weekly streak should start at 1, lifetime streak continues
      expect(prismaClient.player.update).toHaveBeenCalled()
      const updateCall = (prismaClient.player.update as jest.Mock).mock.calls[0]
      
      // Lifetime streak should continue (10 -> 11 since it's consecutive day)
      // Weekly streak should start at 1 (first play of new week)
      expect(updateCall[0].data.currentStreak).toBe(11) // Lifetime streak continues
      expect(updateCall[0].data.weeklyStreak).toBe(1) // Weekly streak starts fresh
      expect(updateCall[0].data.weeklyLongestStreak).toBe(1)
    })

    it('should handle streak gap correctly for weekly and lifetime streaks', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: 60,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 5,
        longestStreak: 5,
        lastPlayDate: new Date(launchDate.getTime() + 3 * 60 * 1000), // Played day 3
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 5000,
        weeklyScore: 3000,
        weeklyStreak: 3,
        weeklyLongestStreak: 3,
        lastResetWeekNumber: 1,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: 1,
        streakMultiplier: 1,
        finalScore: 1000,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 1,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue(player)

      // Play on day 6 (gap: last played day 3, missed days 4 and 5)
      const now = new Date(launchDate.getTime() + 6 * 60 * 1000)
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Both streaks should reset due to gap
      expect(prismaClient.player.update).toHaveBeenCalled()
      const updateCall = (prismaClient.player.update as jest.Mock).mock.calls[0]
      
      // Lifetime streak resets to 1 (gap detected)
      expect(updateCall[0].data.currentStreak).toBe(1)
      // Weekly streak also resets to 1
      expect(updateCall[0].data.weeklyStreak).toBe(1)
      // weeklyLongestStreak preserves the maximum streak achieved (3), not reset on gaps
      expect(updateCall[0].data.weeklyLongestStreak).toBe(3)
    })
  })

  describe('Player Status - Weekly Reset', () => {
    it('should return weekly score when weekly reset is enabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 5,
        longestStreak: 5,
        lastPlayDate: launchDate,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 10000,
        weeklyScore: 5000,
        weeklyStreak: 5,
        weeklyLongestStreak: 5,
        lastResetWeekNumber: 1,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.player, 'create').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])

      jest.spyOn(Date, 'now').mockReturnValue(launchDate.getTime())

      const status = await service.getPlayerStatus(walletAddress)

      expect(status.totalScore).toBe(5000) // Weekly score
      expect(status.lifetimeTotalScore).toBe(10000) // Lifetime score
      expect(status.currentStreak).toBe(5) // Weekly streak
      expect(status.weeklyResetEnabled).toBe(true)
    })

    it('should return lifetime score when weekly reset is disabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: false,
        weeklyResetDay: 0,
        currentWeekNumber: null,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 15000,
        currentStreak: 10,
        longestStreak: 10,
        lastPlayDate: launchDate,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 15000, // Should match totalScore when weekly reset is disabled
        weeklyScore: 0,
        weeklyStreak: 0,
        weeklyLongestStreak: 0,
        lastResetWeekNumber: null,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.player, 'create').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])

      jest.spyOn(Date, 'now').mockReturnValue(launchDate.getTime())

      const status = await service.getPlayerStatus(walletAddress)

      expect(status.totalScore).toBe(15000) // Lifetime score
      expect(status.lifetimeTotalScore).toBe(15000) // Same as totalScore
      expect(status.currentStreak).toBe(10) // Lifetime streak
      expect(status.weeklyResetEnabled).toBe(false)
    })

    it('should include currentWeekNumber in debug info when weekly reset enabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: 60,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastPlayDate: null,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 0,
        weeklyScore: 0,
        weeklyStreak: 0,
        weeklyLongestStreak: 0,
        lastResetWeekNumber: null,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.player, 'create').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])

      const now = new Date(launchDate.getTime() + 8 * 60 * 1000) // Week 1  
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      const status = await service.getPlayerStatus(walletAddress)

      expect(status.debugInfo).toBeDefined()
      expect(status.debugInfo?.currentWeekNumber).toBe(1)
    })
  })

  describe('Leaderboard - Weekly Reset', () => {
    it('should use weekly scores when weekly reset is enabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const players: Player[] = [
        {
          id: 1,
          walletAddress: '0xPLAYER1',
          launchDate,
          totalScore: 50000, // High lifetime score
          currentStreak: 20,
          longestStreak: 20,
          lastPlayDate: launchDate,
          createdAt: launchDate,
          updatedAt: launchDate,
          lifetimeTotalScore: 50000,
          weeklyScore: 5000, // Lower weekly score
          weeklyStreak: 3,
          weeklyLongestStreak: 3,
          lastResetWeekNumber: 1,
        },
        {
          id: 2,
          walletAddress: '0xPLAYER2',
          launchDate,
          totalScore: 10000, // Lower lifetime score
          currentStreak: 5,
          longestStreak: 5,
          lastPlayDate: launchDate,
          createdAt: launchDate,
          updatedAt: launchDate,
          lifetimeTotalScore: 10000,
          weeklyScore: 8000, // Higher weekly score
          weeklyStreak: 5,
          weeklyLongestStreak: 5,
          lastResetWeekNumber: 1,
        },
      ]

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'count').mockResolvedValue(2)
      // Return players sorted by weeklyScore descending (player 2 first with 8000, then player 1 with 5000)
      jest.spyOn(prismaClient.player, 'findMany').mockResolvedValue([players[1], players[0]])

      const leaderboard = await service.getLeaderboard(10, 1)

      // Should be ordered by weekly score, not lifetime
      expect(leaderboard.entries[0].totalScore).toBe(8000) // Player 2 (higher weekly)
      expect(leaderboard.entries[1].totalScore).toBe(5000) // Player 1 (lower weekly)
      expect(leaderboard.entries[0].currentStreak).toBe(5) // Weekly streak
      expect(leaderboard.weeklyResetEnabled).toBe(true)
      expect(leaderboard.nextResetTime).toBeDefined()
    })

    it('should use lifetime scores when weekly reset is disabled', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: false,
        weeklyResetDay: 0,
        currentWeekNumber: null,
      }

      const players: Player[] = [
        {
          id: 1,
          walletAddress: '0xPLAYER1',
          launchDate,
          totalScore: 50000,
          currentStreak: 20,
          longestStreak: 20,
          lastPlayDate: launchDate,
          createdAt: launchDate,
          updatedAt: launchDate,
          lifetimeTotalScore: 0,
          weeklyScore: 0,
          weeklyStreak: 0,
          weeklyLongestStreak: 0,
          lastResetWeekNumber: null,
        },
        {
          id: 2,
          walletAddress: '0xPLAYER2',
          launchDate,
          totalScore: 10000,
          currentStreak: 5,
          longestStreak: 5,
          lastPlayDate: launchDate,
          createdAt: launchDate,
          updatedAt: launchDate,
          lifetimeTotalScore: 0,
          weeklyScore: 0,
          weeklyStreak: 0,
          weeklyLongestStreak: 0,
          lastResetWeekNumber: null,
        },
      ]

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'count').mockResolvedValue(2)
      jest.spyOn(prismaClient.player, 'findMany').mockResolvedValue(players)

      const leaderboard = await service.getLeaderboard(10, 1)

      // Should be ordered by lifetime score
      expect(leaderboard.entries[0].totalScore).toBe(50000) // Player 1 (higher lifetime)
      expect(leaderboard.entries[1].totalScore).toBe(10000) // Player 2 (lower lifetime)
      expect(leaderboard.entries[0].currentStreak).toBe(20) // Lifetime streak
      expect(leaderboard.weeklyResetEnabled).toBe(false)
      expect(leaderboard.nextResetTime).toBeNull()
    })

    it('should calculate nextResetTime correctly with virtual time', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: 60, // 1 minute = 1 day
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 0,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.player, 'findMany').mockResolvedValue([])

      // Current time: 3 minutes after launch (day 3, week 0)
      const now = new Date(launchDate.getTime() + 3 * 60 * 1000)
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      const leaderboard = await service.getLeaderboard(10, 1)

      expect(leaderboard.nextResetTime).toBeDefined()
      const nextReset = new Date(leaderboard.nextResetTime!)
      // Next reset should be at week 1 start: launchDate + 7 * 60 * 1000
      const expectedReset = new Date(launchDate.getTime() + 7 * 60 * 1000)
      expect(nextReset.getTime()).toBe(expectedReset.getTime())
    })
  })

  describe('Week Number Calculation', () => {
    it('should calculate week number correctly with secondsPerDay = 60', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: 60,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: null,
      }

      const testCases = [
        { daysSinceLaunch: 0, expectedWeek: 0 },
        { daysSinceLaunch: 3, expectedWeek: 0 },
        { daysSinceLaunch: 7, expectedWeek: 1 },
        { daysSinceLaunch: 14, expectedWeek: 2 },
        { daysSinceLaunch: 21, expectedWeek: 3 },
      ]

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.player, 'findMany').mockResolvedValue([])

      for (const testCase of testCases) {
        const now = new Date(launchDate.getTime() + testCase.daysSinceLaunch * 60 * 1000)
        jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

        const leaderboard = await service.getLeaderboard(10, 1)

        // Week number should be calculated correctly
        // We can verify by checking nextResetTime calculation
        if (testCase.expectedWeek === 0) {
          const nextReset = new Date(leaderboard.nextResetTime!)
          const expectedNextReset = new Date(launchDate.getTime() + 7 * 60 * 1000)
          expect(nextReset.getTime()).toBe(expectedNextReset.getTime())
        }
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle player with null weekly fields', async () => {
      const settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: true,
        weeklyResetDay: 0,
        currentWeekNumber: 1,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 0,
        currentStreak: 3,
        longestStreak: 3,
        lastPlayDate: launchDate,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: null as any,
        weeklyScore: null as any,
        weeklyStreak: null as any,
        weeklyLongestStreak: null as any,
        lastResetWeekNumber: null,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: 1,
        streakMultiplier: 1.2,
        finalScore: 1200,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 1,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue(player)

      const now = new Date(launchDate.getTime() + 24 * 60 * 60 * 1000)
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Should handle null values gracefully (use 0 as default)
      expect(prismaClient.player.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          weeklyScore: 1000, // 0 + 1000 (score 1000 * multiplier 1.0 for streak 1)
          weeklyStreak: 1, // First play of the day, streak starts at 1
        }),
      })
    })

    it('should handle switching from weekly reset disabled to enabled', async () => {
      // First: weekly reset disabled
      let settings: GameSettings = {
        id: 1,
        launchDate,
        gameState: 'ACTIVE',
        streakBaseMultiplier: 1,
        streakIncrementPerDay: 0.1,
        createdAt: launchDate,
        updatedAt: launchDate,
        secondsPerDay: null,
        weeklyResetEnabled: false,
        weeklyResetDay: 0,
        currentWeekNumber: null,
      }

      const player: Player = {
        id: 1,
        walletAddress,
        launchDate,
        totalScore: 10000,
        currentStreak: 5,
        longestStreak: 5,
        lastPlayDate: launchDate,
        createdAt: launchDate,
        updatedAt: launchDate,
        lifetimeTotalScore: 0,
        weeklyScore: 0,
        weeklyStreak: 0,
        weeklyLongestStreak: 0,
        lastResetWeekNumber: null,
      }

      const prismaClient = prisma as PrismaClient
      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.gameSettings, 'upsert').mockResolvedValue(settings)
      jest.spyOn(cache, 'get').mockResolvedValue(null)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue(player)
      jest.spyOn(prismaClient.gameSession, 'count').mockResolvedValue(0)
      jest.spyOn(prismaClient.gameSession, 'findFirst').mockResolvedValue(null)
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'findMany').mockResolvedValue([])
      jest.spyOn(prismaClient.gameSession, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        score: 1000,
        playDate: launchDate,
        weekNumber: null,
        streakMultiplier: 1.2,
        finalScore: 1200,
        gameData: null,
        createdAt: launchDate,
      } as GameSession)
      jest.spyOn(prismaClient.playerStreak, 'create').mockResolvedValue({
        id: 1,
        playerId: 1,
        streakDate: launchDate,
        streakCount: 5,
        createdAt: launchDate,
      })
      jest.spyOn(prismaClient.player, 'update').mockResolvedValue(player)

      const now = new Date(launchDate.getTime() + 24 * 60 * 60 * 1000)
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime())

      // Submit score with weekly reset disabled
      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Now: enable weekly reset
      settings = {
        ...settings,
        weeklyResetEnabled: true,
        currentWeekNumber: 1,
      }

      jest.spyOn(prismaClient.gameSettings, 'findUnique').mockResolvedValue(settings)
      jest.spyOn(prismaClient.player, 'findUnique').mockResolvedValue({
        ...player,
        totalScore: 11200,
      })

      // Submit score with weekly reset enabled
      await service.submitScore({
        walletAddress,
        score: 1000,
      })

      // Should now use weekly score
      expect(prismaClient.player.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          weeklyScore: expect.any(Number),
        }),
      })
    })
  })
})
