import test from 'node:test';
import assert from 'node:assert/strict';
import { getEconomicCalendar } from '../src/calendar.js';

test('economic calendar reports API 필요 honestly when no FRED key is configured', async () => {
  // No FRED_API_KEY in the test env -> deterministic, no network call.
  const result = await getEconomicCalendar({});
  assert.equal(result.status, 'API 필요');
  assert.deepEqual(result.events, []);
  assert.ok(result.statusMessage.includes('FRED_API_KEY'));
});
