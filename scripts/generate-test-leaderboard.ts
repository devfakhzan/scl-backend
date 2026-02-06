import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Initialize PrismaClient with PostgreSQL adapter (same as PrismaService)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required')
}

const pool = new Pool({ connectionString: databaseUrl })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function generateTestLeaderboard(count: number = 1000) {
  console.log(`Generating ${count} test players...`)

  const players = []
  for (let i = 0; i < count; i++) {
    // Generate random wallet address
    const walletAddress = `0x${Array.from({ length: 40 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`

    // Generate random scores (higher scores more rare)
    const baseScore = Math.floor(Math.random() * 10000)
    const bonusScore = Math.random() < 0.1 ? Math.floor(Math.random() * 50000) : 0
    const totalScore = baseScore + bonusScore

    // Random streak (0-30 days)
    const currentStreak = Math.floor(Math.random() * 31)
    const longestStreak = Math.max(currentStreak, Math.floor(Math.random() * 50))

    players.push({
      walletAddress,
      totalScore,
      currentStreak,
      longestStreak,
      lifetimeTotalScore: totalScore,
      weeklyScore: Math.floor(totalScore * 0.3), // Some weekly score
      weeklyStreak: Math.floor(currentStreak * 0.5),
      weeklyLongestStreak: Math.floor(longestStreak * 0.5),
    })
  }

  // Insert in batches
  const batchSize = 100
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize)
    await prisma.player.createMany({
      data: batch,
      skipDuplicates: true,
    })
    console.log(`Created ${Math.min(i + batchSize, players.length)}/${players.length} players`)
  }

  console.log(`✅ Generated ${count} test players`)
}

async function cleanupTestLeaderboard() {
  console.log('Cleaning up test leaderboard data...')
  
  // Delete all players with test wallet addresses (0x followed by 40 hex chars)
  // But keep any that start with 0xTEST (for actual test accounts)
  const result = await prisma.$executeRaw`
    DELETE FROM "Player" 
    WHERE "walletAddress" ~ '^0x[0-9a-f]{40}$'
    AND "walletAddress" NOT LIKE '0xTEST%'
  `
  
  console.log(`✅ Deleted ${result} test players`)
}

async function main() {
  const command = process.argv[2]
  const count = parseInt(process.argv[3] || '1000', 10)

  try {
    // Connect to database
    await prisma.$connect()
    console.log('✅ Connected to database')

    if (command === 'generate') {
      await generateTestLeaderboard(count)
    } else if (command === 'cleanup') {
      await cleanupTestLeaderboard()
    } else {
      console.log('Usage:')
      console.log('  yarn test:leaderboard:generate [count]  - Generate test players (default: 1000)')
      console.log('  yarn test:leaderboard:cleanup            - Remove test players')
      process.exit(1)
    }
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
