export class GetPlayerStatusDto {
  walletAddress: string
  totalScore: number // Weekly score if weeklyResetEnabled, otherwise lifetime score
  lifetimeTotalScore?: number // Always the lifetime score (preserved across resets)
  currentStreak: number // Weekly streak if weeklyResetEnabled, otherwise lifetime streak
  longestStreak: number // Weekly longest streak if weeklyResetEnabled, otherwise lifetime longest streak
  playsRemaining: number
  canPlay: boolean
  streakMultiplier: number
  hasValidStreak: boolean
  weeklyResetEnabled?: boolean // Whether weekly resets are enabled
  // When a new play becomes available (ISO string, server time) or null if already can play
  nextAvailableAt: string | null
  // Convenience: seconds until next play becomes available, from server's perspective
  secondsToNextPlay: number | null
  // Debug info when secondsPerDay is set (testing mode)
  debugInfo?: {
    secondsPerDay: number
    virtualDay: number
    virtualDayStart: string
    virtualDayEnd: string
    nextVirtualDayStart: string
    totalPlaysAllowed: number
    totalPlaysUsed: number
    lastPlayVirtualDay: number | null
    launchDate: string
    currentWeekNumber?: number // Current week number (when weekly resets enabled)
  }
}
