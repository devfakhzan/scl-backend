import { Injectable, HttpException, HttpStatus, Inject, forwardRef } from '@nestjs/common'
import { PrismaService, PrismaClient } from '../prisma/prisma.service'
import { WordpressService } from '../wordpress/wordpress.service'
import { GameService } from './game.service'

@Injectable()
export class ReferralService {
  private readonly prisma: PrismaClient

  constructor(
    private readonly wordpressService: WordpressService,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
    private readonly prismaService: PrismaService,
  ) {
    this.prisma = prismaService
  }

  /**
   * Apply a referral code to a wallet address
   * Returns the number of extra plays granted
   */
  async applyReferralCode(walletAddress: string, code: string): Promise<{ extraPlays: number; message: string }> {
    // Normalize wallet address
    const normalizedWallet = walletAddress.toLowerCase()

    // Check if wallet already has a referral code
    const existingReferral = await this.prisma.referralCode.findUnique({
      where: { walletAddress: normalizedWallet },
    })

    if (existingReferral) {
      throw new HttpException(
        'This wallet has already used a referral code',
        HttpStatus.BAD_REQUEST,
      )
    }

    // Validate that the code exists in WordPress
    const refCodePost = await this.wordpressService.getGameRefCodeByCode(code)
    if (!refCodePost) {
      throw new HttpException(
        'Invalid referral code',
        HttpStatus.NOT_FOUND,
      )
    }

    // Get game settings to determine extra plays
    const settings = await this.gameService.getSettings()
    const extraPlays = settings.referralExtraPlays ?? 3

    // Create referral code record
    await this.prisma.referralCode.create({
      data: {
        walletAddress: normalizedWallet,
        code: refCodePost.slug.toLowerCase(),
        extraPlaysTotal: extraPlays,
        extraPlaysUsed: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    return {
      extraPlays,
      message: `Referral code applied! You received ${extraPlays} extra plays.`,
    }
  }

  /**
   * Get referral information for a wallet
   */
  async getReferralInfo(walletAddress: string): Promise<{
    hasReferral: boolean
    code?: string
    extraPlaysTotal?: number
    extraPlaysUsed?: number
    extraPlaysRemaining?: number
  }> {
    const normalizedWallet = walletAddress.toLowerCase()
    const referral = await this.prisma.referralCode.findUnique({
      where: { walletAddress: normalizedWallet },
    })

    if (!referral) {
      return { hasReferral: false }
    }

    return {
      hasReferral: true,
      code: referral.code,
      extraPlaysTotal: referral.extraPlaysTotal,
      extraPlaysUsed: referral.extraPlaysUsed,
      extraPlaysRemaining: referral.extraPlaysTotal - referral.extraPlaysUsed,
    }
  }

  /**
   * Mark a referral play as used (called when a game session is created)
   */
  async useReferralPlay(walletAddress: string): Promise<boolean> {
    const normalizedWallet = walletAddress.toLowerCase()
    const referral = await this.prisma.referralCode.findUnique({
      where: { walletAddress: normalizedWallet },
    })

    if (!referral) {
      return false // No referral code, so this wasn't a referral play
    }

    // Check if there are any referral plays remaining
    if (referral.extraPlaysUsed >= referral.extraPlaysTotal) {
      return false // All referral plays used
    }

    // Increment used count
    await this.prisma.referralCode.update({
      where: { walletAddress: normalizedWallet },
      data: {
        extraPlaysUsed: referral.extraPlaysUsed + 1,
      },
    })

    return true // Successfully used a referral play
  }
}
