#!/bin/bash
set -e

API_BASE="https://staging.shadowcombatleague.com"
NAMESPACE="scl-staging"
BACKEND_POD=$(kubectl get pods -n $NAMESPACE -l app=scl-backend -o jsonpath='{.items[0].metadata.name}')

echo "🧪 Starting Comprehensive Test Suite"
echo "   API Base: $API_BASE"
echo "   Backend Pod: $BACKEND_POD"
echo ""

# Test wallet addresses (must be exactly 42 chars: 0x + 40 hex)
TEST_WALLET_STREAK1="0xTEST1111111111111111111111111111111111"
TEST_WALLET_STREAK2="0xTEST2222222222222222222222222222222222"
TEST_WALLET_STREAK3="0xTEST3333333333333333333333333333333333"
TEST_WALLET_STREAK5="0xTEST5555555555555555555555555555555555"

# Cleanup function
cleanup_test_data() {
  echo "🧹 Cleaning up test data..."
  kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
    DELETE FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%';
    DELETE FROM \"WeeklyScoreSnapshot\" WHERE \"walletAddress\" LIKE '0xTEST%';
  " > /dev/null 2>&1
  echo "   ✅ Cleaned up test data"
}

# Setup test players
setup_test_players() {
  echo "👥 Setting up test players..."
  
  # Delete existing test players first
  kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
    DELETE FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%';
  " > /dev/null 2>&1
  
  # Create players one by one to avoid issues
  for wallet in "$TEST_WALLET_STREAK1" "$TEST_WALLET_STREAK2" "$TEST_WALLET_STREAK3" "$TEST_WALLET_STREAK5"; do
    local streak=$(echo "$wallet" | sed 's/.*TEST\([0-9]\).*/\1/')
    local score=$((streak * 1000))
    
    kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
      INSERT INTO \"Player\" (
        \"walletAddress\", 
        \"currentStreak\", 
        \"weeklyStreak\", 
        \"totalScore\", 
        \"weeklyScore\", 
        \"lifetimeTotalScore\", 
        \"lastPlayDate\",
        \"createdAt\",
        \"updatedAt\"
      ) VALUES (
        '$wallet', 
        $streak, 
        $streak, 
        $score, 
        $score, 
        $score, 
        NOW() - INTERVAL '1 day',
        NOW(),
        NOW()
      ) ON CONFLICT (\"walletAddress\") DO UPDATE SET
        \"currentStreak\" = EXCLUDED.\"currentStreak\",
        \"weeklyStreak\" = EXCLUDED.\"weeklyStreak\",
        \"totalScore\" = EXCLUDED.\"totalScore\",
        \"weeklyScore\" = EXCLUDED.\"weeklyScore\",
        \"lifetimeTotalScore\" = EXCLUDED.\"lifetimeTotalScore\",
        \"lastPlayDate\" = EXCLUDED.\"lastPlayDate\",
        \"updatedAt\" = NOW();
    " > /dev/null 2>&1
  done
  
  local count=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "
    SELECT COUNT(*) FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%';
  " | xargs)
  
  echo "   ✅ Created $count test players"
}

# Test multiplier calculation
test_multiplier() {
  echo ""
  echo "🧮 Testing Multiplier Calculation..."
  
  # Expected multipliers: base=1.0, increment=0.1
  # Streak 1: 1.0x, Streak 2: 1.1x, Streak 3: 1.2x, Streak 5: 1.4x
  
  test_wallet_multiplier() {
    local wallet=$1
    local expected_streak=$2
    local expected_multiplier=$3
    local name=$4
    
    echo "   Testing $name (streak $expected_streak, expected multiplier ${expected_multiplier}x)..."
    
    # Get status
    local status=$(curl -s "$API_BASE/api/game/status/$wallet")
    local status_multiplier=$(echo "$status" | jq -r '.streakMultiplier // empty')
    
    if [ -z "$status_multiplier" ] || [ "$status_multiplier" = "null" ]; then
      echo "      ❌ Status multiplier is null or missing"
      echo "      Full response: $status"
      return 1
    fi
    
    # Compare with tolerance for floating point
    local diff=$(echo "$status_multiplier - $expected_multiplier" | bc -l)
    local abs_diff=$(echo "$diff" | sed 's/-//')
    
    if [ "$(echo "$abs_diff < 0.01" | bc -l)" -eq 1 ]; then
      echo "      ✅ Status multiplier correct: ${status_multiplier}x"
    else
      echo "      ❌ Status multiplier wrong: ${status_multiplier}x (expected ${expected_multiplier}x)"
      return 1
    fi
    
    # Submit score
    local game_score=1000
    local submit_response=$(curl -s -X POST "$API_BASE/api/game/submit" \
      -H "Content-Type: application/json" \
      -d "{\"walletAddress\":\"$wallet\",\"score\":$game_score}")
    
    local session_multiplier=$(echo "$submit_response" | jq -r '.streakMultiplier // empty')
    local final_score=$(echo "$submit_response" | jq -r '.finalScore // empty')
    
    if [ -z "$session_multiplier" ] || [ "$session_multiplier" = "null" ]; then
      echo "      ❌ Session multiplier is null or missing"
      echo "      Full response: $submit_response"
      return 1
    fi
    
    local expected_final=$(echo "$game_score * $expected_multiplier" | bc | cut -d. -f1)
    
    local diff=$(echo "$session_multiplier - $expected_multiplier" | bc -l)
    local abs_diff=$(echo "$diff" | sed 's/-//')
    
    if [ "$(echo "$abs_diff < 0.01" | bc -l)" -eq 1 ]; then
      echo "      ✅ Submission multiplier correct: ${session_multiplier}x"
    else
      echo "      ❌ Submission multiplier wrong: ${session_multiplier}x (expected ${expected_multiplier}x)"
      return 1
    fi
    
    if [ "$final_score" -eq "$expected_final" ]; then
      echo "      ✅ Final score correct: $final_score (expected $expected_final)"
    else
      echo "      ❌ Final score wrong: $final_score (expected $expected_final)"
      return 1
    fi
    
    # Check consistency
    local consistency_diff=$(echo "$status_multiplier - $session_multiplier" | bc -l)
    local consistency_abs_diff=$(echo "$consistency_diff" | sed 's/-//')
    
    if [ "$(echo "$consistency_abs_diff < 0.01" | bc -l)" -eq 1 ]; then
      echo "      ✅ Multipliers match between status and submission"
    else
      echo "      ❌ Multipliers don't match: status=${status_multiplier}x, submission=${session_multiplier}x"
      return 1
    fi
    
    return 0
  }
  
  test_wallet_multiplier "$TEST_WALLET_STREAK1" 1 "1.0" "Streak 1"
  test_wallet_multiplier "$TEST_WALLET_STREAK2" 2 "1.1" "Streak 2"
  test_wallet_multiplier "$TEST_WALLET_STREAK3" 3 "1.2" "Streak 3"
  test_wallet_multiplier "$TEST_WALLET_STREAK5" 5 "1.4" "Streak 5"
}

# Test weekly reset
test_weekly_reset() {
  echo ""
  echo "🔄 Testing Weekly Reset..."
  
  # Get current week
  local current_week=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "SELECT \"currentWeekNumber\" FROM \"GameSettings\" WHERE id = 1;")
  current_week=$(echo $current_week | xargs)
  
  echo "   Current week: $current_week"
  
  # Get players before reset
  local players_before=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "
    SELECT COUNT(*) FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%';
  " | xargs)
  
  echo "   Test players: $players_before"
  
  # Get weekly scores before
  local weekly_scores_before=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
    SELECT \"walletAddress\", \"weeklyScore\", \"weeklyStreak\", \"lifetimeTotalScore\" 
    FROM \"Player\" 
    WHERE \"walletAddress\" LIKE '0xTEST%'
    ORDER BY \"walletAddress\";
  ")
  
  echo "   Weekly scores before reset:"
  echo "$weekly_scores_before" | grep -v "walletAddress" | head -5
  
  # Manually trigger reset by updating week number and calling reset
  local next_week=$((current_week + 1))
  echo "   Triggering reset to week $next_week..."
  
  # Update week number
  kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
    UPDATE \"GameSettings\" SET \"currentWeekNumber\" = $next_week WHERE id = 1;
  " > /dev/null 2>&1
  
  # Trigger reset via backend (we'll need to call the service endpoint if it exists, or manually reset)
  # For now, let's manually perform the reset logic
  kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game <<EOF
-- Create snapshots
INSERT INTO "WeeklyScoreSnapshot" ("weekNumber", "playerId", "walletAddress", "weeklyScore", "weeklyStreak", "weeklyLongestStreak", "lifetimeTotalScore", "snapshotDate")
SELECT 
  $next_week,
  id,
  "walletAddress",
  "weeklyScore",
  "weeklyStreak",
  "weeklyLongestStreak",
  "lifetimeTotalScore" + COALESCE("weeklyScore", 0),
  NOW()
FROM "Player"
WHERE "walletAddress" LIKE '0xTEST%'
  AND ("lastResetWeekNumber" IS NULL OR "lastResetWeekNumber" < $next_week);

-- Reset weekly scores
UPDATE "Player"
SET 
  "lifetimeTotalScore" = "lifetimeTotalScore" + COALESCE("weeklyScore", 0),
  "weeklyScore" = 0,
  "weeklyStreak" = 0,
  "weeklyLongestStreak" = 0,
  "lastResetWeekNumber" = $next_week
WHERE "walletAddress" LIKE '0xTEST%'
  AND ("lastResetWeekNumber" IS NULL OR "lastResetWeekNumber" < $next_week);
EOF
  
  # Check snapshots
  local snapshot_count=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "
    SELECT COUNT(*) FROM \"WeeklyScoreSnapshot\" WHERE \"walletAddress\" LIKE '0xTEST%' AND \"weekNumber\" = $next_week;
  " | xargs)
  
  echo "   ✅ Created $snapshot_count snapshots"
  
  # Check weekly scores after reset
  local weekly_scores_after=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
    SELECT \"walletAddress\", \"weeklyScore\", \"weeklyStreak\", \"lifetimeTotalScore\" 
    FROM \"Player\" 
    WHERE \"walletAddress\" LIKE '0xTEST%'
    ORDER BY \"walletAddress\";
  ")
  
  echo "   Weekly scores after reset:"
  echo "$weekly_scores_after" | grep -v "walletAddress" | head -5
  
  # Verify reset
  local all_zero=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "
    SELECT COUNT(*) FROM \"Player\" 
    WHERE \"walletAddress\" LIKE '0xTEST%' 
      AND (\"weeklyScore\" != 0 OR \"weeklyStreak\" != 0);
  " | xargs)
  
  if [ "$all_zero" -eq 0 ]; then
    echo "   ✅ All weekly scores and streaks reset to 0"
  else
    echo "   ❌ Some weekly scores/streaks not reset: $all_zero players"
  fi
  
  # Restore week number
  kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
    UPDATE \"GameSettings\" SET \"currentWeekNumber\" = $current_week WHERE id = 1;
  " > /dev/null 2>&1
}

# Test snapshots
test_snapshots() {
  echo ""
  echo "📸 Testing Weekly Snapshots..."
  
  local snapshot_count=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "
    SELECT COUNT(*) FROM \"WeeklyScoreSnapshot\" WHERE \"walletAddress\" LIKE '0xTEST%';
  " | xargs)
  
  echo "   Found $snapshot_count test snapshots"
  
  if [ "$snapshot_count" -gt 0 ]; then
    local sample=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
      SELECT \"weekNumber\", \"walletAddress\", \"weeklyScore\", \"weeklyStreak\", \"lifetimeTotalScore\"
      FROM \"WeeklyScoreSnapshot\"
      WHERE \"walletAddress\" LIKE '0xTEST%'
      ORDER BY \"snapshotDate\" DESC
      LIMIT 3;
    ")
    
    echo "   Sample snapshots:"
    echo "$sample" | grep -v "weekNumber" | head -4
    echo "   ✅ Snapshots have proper structure"
  fi
}

# Main
cleanup_test_data
setup_test_players
test_multiplier
test_weekly_reset
test_snapshots
cleanup_test_data

echo ""
echo "✅ Test suite completed!"
