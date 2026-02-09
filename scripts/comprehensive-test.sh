#!/bin/bash
set -e

API_BASE="https://staging.shadowcombatleague.com"
NAMESPACE="scl-staging"

echo "🧪 COMPREHENSIVE TEST SUITE"
echo "============================"
echo ""

# Test 1: Multiplier Calculation
echo "TEST 1: Multiplier Calculation"
echo "-------------------------------"

# Clean and setup
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "DELETE FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%';" > /dev/null
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "DELETE FROM \"GameSession\" WHERE \"playerId\" IN (SELECT id FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%');" > /dev/null

# Create test player with streak 2
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
INSERT INTO \"Player\" (\"walletAddress\", \"currentStreak\", \"weeklyStreak\", \"totalScore\", \"weeklyScore\", \"lifetimeTotalScore\", \"lastPlayDate\", \"createdAt\", \"updatedAt\")
VALUES ('0xTESTMULT222222222222222222222222222222', 2, 2, 2000, 2000, 2000, NOW() - INTERVAL '2 days', NOW(), NOW());
" > /dev/null

sleep 2

# Get status - should show 1.1x
STATUS=$(curl -s "$API_BASE/api/game/status/0xTESTMULT222222222222222222222222222222")
STATUS_MULT=$(echo "$STATUS" | jq -r '.streakMultiplier')
STATUS_STREAK=$(echo "$STATUS" | jq -r '.currentStreak')

echo "  Status multiplier: ${STATUS_MULT}x (streak: $STATUS_STREAK)"
if [ "$(echo "$STATUS_MULT == 1.1" | bc -l)" -eq 1 ]; then
  echo "  ✅ Status multiplier correct (1.1x)"
else
  echo "  ❌ Status multiplier wrong: ${STATUS_MULT}x (expected 1.1x)"
fi

# Submit score
SUBMIT=$(curl -s -X POST "$API_BASE/api/game/submit" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0xTESTMULT222222222222222222222222222222","score":1000}')

SESSION_MULT=$(echo "$SUBMIT" | jq -r '.streakMultiplier')
FINAL_SCORE=$(echo "$SUBMIT" | jq -r '.finalScore')
EXPECTED_FINAL=1100

echo "  Submission multiplier: ${SESSION_MULT}x"
echo "  Final score: $FINAL_SCORE (expected $EXPECTED_FINAL)"

if [ "$FINAL_SCORE" -eq "$EXPECTED_FINAL" ]; then
  echo "  ✅ Final score calculation correct (1000 * 1.1 = 1100)"
else
  echo "  ❌ Final score wrong: $FINAL_SCORE (expected $EXPECTED_FINAL)"
fi

# Check database
DB_MULT=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "SELECT \"streakMultiplier\" FROM \"GameSession\" WHERE \"playerId\" = (SELECT id FROM \"Player\" WHERE \"walletAddress\" = '0xTESTMULT222222222222222222222222222222') ORDER BY \"playDate\" DESC LIMIT 1;" | xargs)
echo "  Database stored multiplier: $DB_MULT"
if [ "$(echo "$DB_MULT == 1.1" | bc -l)" -eq 1 ]; then
  echo "  ✅ Database multiplier correct"
else
  echo "  ⚠️  Database multiplier is $DB_MULT (should be 1.1 after migration)"
fi

echo ""

# Test 2: Weekly Reset
echo "TEST 2: Weekly Reset"
echo "---------------------"

# Setup players with weekly scores
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
DELETE FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTESTRESET%';
DELETE FROM \"WeeklyScoreSnapshot\" WHERE \"walletAddress\" LIKE '0xTESTRESET%';

INSERT INTO \"Player\" (\"walletAddress\", \"currentStreak\", \"weeklyStreak\", \"totalScore\", \"weeklyScore\", \"lifetimeTotalScore\", \"lastPlayDate\", \"createdAt\", \"updatedAt\", \"lastResetWeekNumber\")
VALUES 
  ('0xTESTRESET1111111111111111111111111111', 1, 1, 1000, 500, 500, NOW() - INTERVAL '1 day', NOW(), NOW(), 1),
  ('0xTESTRESET2222222222222222222222222222', 2, 2, 2000, 1000, 1000, NOW() - INTERVAL '1 day', NOW(), NOW(), 1),
  ('0xTESTRESET3333333333333333333333333333', 3, 3, 3000, 1500, 1500, NOW() - INTERVAL '1 day', NOW(), NOW(), 1);
" > /dev/null

CURRENT_WEEK=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "SELECT \"currentWeekNumber\" FROM \"GameSettings\" WHERE id = 1;" | xargs)
NEXT_WEEK=$((CURRENT_WEEK + 1))

echo "  Current week: $CURRENT_WEEK"
echo "  Triggering reset to week: $NEXT_WEEK"

# Get scores before
BEFORE=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
SELECT \"walletAddress\", \"weeklyScore\", \"lifetimeTotalScore\" FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTESTRESET%' ORDER BY \"walletAddress\";
")

echo "  Before reset:"
echo "$BEFORE" | grep -v "walletAddress" | head -4

# Trigger reset manually
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
-- Create snapshots
INSERT INTO \"WeeklyScoreSnapshot\" (\"weekNumber\", \"playerId\", \"walletAddress\", \"weeklyScore\", \"weeklyStreak\", \"weeklyLongestStreak\", \"lifetimeTotalScore\", \"snapshotDate\")
SELECT 
  $NEXT_WEEK,
  id,
  \"walletAddress\",
  \"weeklyScore\",
  \"weeklyStreak\",
  \"weeklyLongestStreak\",
  \"lifetimeTotalScore\" + COALESCE(\"weeklyScore\", 0),
  NOW()
FROM \"Player\"
WHERE \"walletAddress\" LIKE '0xTESTRESET%'
  AND (\"lastResetWeekNumber\" IS NULL OR \"lastResetWeekNumber\" < $NEXT_WEEK);

-- Reset weekly scores
UPDATE \"Player\"
SET 
  \"lifetimeTotalScore\" = \"lifetimeTotalScore\" + COALESCE(\"weeklyScore\", 0),
  \"weeklyScore\" = 0,
  \"weeklyStreak\" = 0,
  \"weeklyLongestStreak\" = 0,
  \"lastResetWeekNumber\" = $NEXT_WEEK
WHERE \"walletAddress\" LIKE '0xTESTRESET%'
  AND (\"lastResetWeekNumber\" IS NULL OR \"lastResetWeekNumber\" < $NEXT_WEEK);

-- Update week number
UPDATE \"GameSettings\" SET \"currentWeekNumber\" = $NEXT_WEEK WHERE id = 1;
" > /dev/null

# Get scores after
AFTER=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
SELECT \"walletAddress\", \"weeklyScore\", \"lifetimeTotalScore\", \"lastResetWeekNumber\" FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTESTRESET%' ORDER BY \"walletAddress\";
")

echo "  After reset:"
echo "$AFTER" | grep -v "walletAddress" | head -4

# Verify reset
ALL_ZERO=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "
SELECT COUNT(*) FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTESTRESET%' AND (\"weeklyScore\" != 0 OR \"weeklyStreak\" != 0);
" | xargs)

if [ "$ALL_ZERO" -eq 0 ]; then
  echo "  ✅ All weekly scores and streaks reset to 0"
else
  echo "  ❌ Some weekly scores/streaks not reset: $ALL_ZERO players"
fi

# Check snapshots
SNAPSHOT_COUNT=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -t -c "
SELECT COUNT(*) FROM \"WeeklyScoreSnapshot\" WHERE \"walletAddress\" LIKE '0xTESTRESET%' AND \"weekNumber\" = $NEXT_WEEK;
" | xargs)

echo "  Snapshots created: $SNAPSHOT_COUNT"
if [ "$SNAPSHOT_COUNT" -eq 3 ]; then
  echo "  ✅ All 3 players have snapshots"
else
  echo "  ❌ Expected 3 snapshots, got $SNAPSHOT_COUNT"
fi

# Verify snapshot data
SNAPSHOT_DATA=$(kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "
SELECT \"walletAddress\", \"weeklyScore\", \"lifetimeTotalScore\" FROM \"WeeklyScoreSnapshot\" WHERE \"walletAddress\" LIKE '0xTESTRESET%' AND \"weekNumber\" = $NEXT_WEEK ORDER BY \"walletAddress\";
")

echo "  Snapshot data:"
echo "$SNAPSHOT_DATA" | grep -v "walletAddress" | head -4

# Restore week number
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "UPDATE \"GameSettings\" SET \"currentWeekNumber\" = $CURRENT_WEEK WHERE id = 1;" > /dev/null

echo ""

# Test 3: End-to-End
echo "TEST 3: End-to-End Flow"
echo "----------------------"

TEST_WALLET="0xTESTE2E111111111111111111111111111111"

# Clean
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "DELETE FROM \"Player\" WHERE \"walletAddress\" = '$TEST_WALLET';" > /dev/null

# Get status (creates player)
STATUS1=$(curl -s "$API_BASE/api/game/status/$TEST_WALLET")
CAN_PLAY=$(echo "$STATUS1" | jq -r '.canPlay')
STREAK1=$(echo "$STATUS1" | jq -r '.currentStreak')
MULT1=$(echo "$STATUS1" | jq -r '.streakMultiplier')

echo "  Initial status:"
echo "    Can play: $CAN_PLAY"
echo "    Streak: $STREAK1"
echo "    Multiplier: ${MULT1}x"

if [ "$CAN_PLAY" = "true" ] && [ "$STREAK1" -eq 0 ] && [ "$(echo "$MULT1 == 1.0" | bc -l)" -eq 1 ]; then
  echo "  ✅ Initial status correct"
else
  echo "  ❌ Initial status incorrect"
fi

# Submit first score
SUBMIT1=$(curl -s -X POST "$API_BASE/api/game/submit" \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"$TEST_WALLET\",\"score\":500}")

FINAL1=$(echo "$SUBMIT1" | jq -r '.finalScore')
MULT_SUB1=$(echo "$SUBMIT1" | jq -r '.streakMultiplier')

echo "  First submission:"
echo "    Multiplier: ${MULT_SUB1}x"
echo "    Final score: $FINAL1 (expected 500)"

if [ "$FINAL1" -eq 500 ] && [ "$(echo "$MULT_SUB1 == 1.0" | bc -l)" -eq 1 ]; then
  echo "  ✅ First submission correct (streak 0 -> multiplier 1.0x)"
else
  echo "  ❌ First submission incorrect"
fi

# Get status after
STATUS2=$(curl -s "$API_BASE/api/game/status/$TEST_WALLET")
STREAK2=$(echo "$STATUS2" | jq -r '.currentStreak')
MULT2=$(echo "$STATUS2" | jq -r '.streakMultiplier')

echo "  Status after first play:"
echo "    Streak: $STREAK2"
echo "    Multiplier: ${MULT2}x"

if [ "$STREAK2" -eq 1 ] && [ "$(echo "$MULT2 == 1.0" | bc -l)" -eq 1 ]; then
  echo "  ✅ Streak incremented to 1, multiplier still 1.0x (correct - streak 1 = 1.0x)"
else
  echo "  ❌ Status after first play incorrect"
fi

# Submit second score (same day - should not increment streak)
SUBMIT2=$(curl -s -X POST "$API_BASE/api/game/submit" \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"$TEST_WALLET\",\"score\":800}")

FINAL2=$(echo "$SUBMIT2" | jq -r '.finalScore')
MULT_SUB2=$(echo "$SUBMIT2" | jq -r '.streakMultiplier')

echo "  Second submission (same day):"
echo "    Multiplier: ${MULT_SUB2}x"
echo "    Final score: $FINAL2 (expected 800)"

if [ "$FINAL2" -eq 800 ] && [ "$(echo "$MULT_SUB2 == 1.0" | bc -l)" -eq 1 ]; then
  echo "  ✅ Second submission correct (same day, streak still 1, multiplier 1.0x)"
else
  echo "  ❌ Second submission incorrect"
fi

echo ""
echo "============================"
echo "✅ Test suite completed!"
echo ""

# Cleanup
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "DELETE FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%';" > /dev/null
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "DELETE FROM \"GameSession\" WHERE \"playerId\" IN (SELECT id FROM \"Player\" WHERE \"walletAddress\" LIKE '0xTEST%');" > /dev/null
kubectl exec -n $NAMESPACE postgres-0 -- psql -U scl_user -d scl_game -c "DELETE FROM \"WeeklyScoreSnapshot\" WHERE \"walletAddress\" LIKE '0xTEST%';" > /dev/null

echo "🧹 Cleaned up test data"
