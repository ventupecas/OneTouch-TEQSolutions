// What a Claude call cost (usage.mjs costUsd), from made-up usage objects.
// No database or API needed: npm test.
import assert from 'node:assert/strict';
import { costUsd } from '../usage.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// Sonnet 5.5: $2 in, $10 out, $0.20 cache read, $2.50 / $4 cache write (5 min / 1 h)
near(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 0 }), 2);
near(costUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 1_000_000 }), 10);
near(costUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }), 0.2);
// An older response with only the total written: priced as 5-minute writes
near(costUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }), 2.5);
// Split by how long they're kept
near(costUsd('claude-sonnet-5-5', {
  input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2_000_000,
  cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
}), 6.5);
// A typical warm translation: 20k cached, 300 new, 220 out
near(costUsd('claude-sonnet-5-5', { input_tokens: 300, output_tokens: 220, cache_read_input_tokens: 20_000 }), (300 * 2 + 220 * 10 + 20_000 * 0.2) / 1e6);
// Haiku 5.5 is priced too; unknown models and missing usage give null
near(costUsd('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6);
assert.equal(costUsd('claude-unknown', { input_tokens: 5, output_tokens: 5 }), null);
assert.equal(costUsd('claude-sonnet-5-5', null), null);

console.log('usage: 9 checks passed');
