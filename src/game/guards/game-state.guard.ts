import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { GameService } from '../game.service'

type GameState = 'ACTIVE' | 'IN_MAINTENANCE' | 'DISABLED'

interface SettingsWithGameState {
  gameState: GameState
  launchDate: Date
}

function hasGameState(settings: unknown): settings is SettingsWithGameState {
  return typeof settings === 'object' && settings !== null && 'gameState' in settings
}

@Injectable()
export class GameStateGuard implements CanActivate {
  constructor(private readonly gameService: GameService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const settings = await this.gameService.getSettings()
    const now = new Date()

    // Type guard to safely access gameState
    if (!hasGameState(settings)) {
      // Default to ACTIVE if gameState is missing (shouldn't happen after migration)
      return true
    }

    const gameState = settings.gameState

    // Check game state
    if (gameState === 'DISABLED') {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Game is currently disabled',
          error: 'Game Disabled',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    }

    if (gameState === 'IN_MAINTENANCE') {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Game is currently under maintenance',
          error: 'Maintenance Mode',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    }

    // If ACTIVE but before launch date, reject requests
    if (gameState === 'ACTIVE' && now < settings.launchDate) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Game has not launched yet',
          error: 'Game Not Launched',
          launchDate: settings.launchDate.toISOString(),
        },
        HttpStatus.FORBIDDEN,
      )
    }

    return true
  }
}
