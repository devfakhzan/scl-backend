import { Pool } from 'pg'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required')
}

const pool = new Pool({ connectionString: databaseUrl })

async function addHiddenEnum() {
  try {
    console.log('Adding HIDDEN to GameState enum...')
    
    // Check if HIDDEN already exists
    const checkResult = await pool.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'GameState')
      AND enumlabel = 'HIDDEN'
    `)
    
    if (checkResult.rows.length > 0) {
      console.log('✅ HIDDEN already exists in GameState enum')
      return
    }
    
    // Add HIDDEN to the enum
    await pool.query(`
      ALTER TYPE "GameState" ADD VALUE 'HIDDEN'
    `)
    
    console.log('✅ Successfully added HIDDEN to GameState enum')
  } catch (error) {
    console.error('❌ Error adding HIDDEN to enum:', error)
    throw error
  } finally {
    await pool.end()
  }
}

addHiddenEnum()
  .then(() => {
    console.log('Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Failed:', error)
    process.exit(1)
  })
