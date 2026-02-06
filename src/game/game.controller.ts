import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common'
import { GameService } from './game.service'
import { SubmitScoreDto } from './dto/submit-score.dto'
import { GameStateGuard } from './guards/game-state.guard'

@Controller('api/game')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Get('state')
  async getGameState() {
    return this.gameService.getGameState()
  }

  @Get('status/:walletAddress')
  @UseGuards(GameStateGuard)
  async getStatus(@Param('walletAddress') walletAddress: string) {
    return this.gameService.getPlayerStatus(walletAddress)
  }

  @Post('submit')
  @UseGuards(GameStateGuard)
  async submitScore(@Body() dto: SubmitScoreDto) {
    return this.gameService.submitScore(dto)
  }

  @Get('leaderboard')
  async getLeaderboard(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('userAddress') userAddress?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10
    const pageNum = page ? parseInt(page, 10) : 1
    return this.gameService.getLeaderboard(limitNum, pageNum, userAddress)
  }

  @Get('history/:walletAddress')
  @UseGuards(GameStateGuard)
  async getHistory(@Param('walletAddress') walletAddress: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50
    return this.gameService.getPlayerHistory(walletAddress, limitNum)
  }

  @Get('test-cache')
  async testCache() {
    // Force cache usage for testing
    const settings = await this.gameService.getSettings()
    return { 
      message: 'Cache test - check Redis for game:settings key',
      settingsId: settings.id,
      timestamp: new Date().toISOString()
    }
  }
}
