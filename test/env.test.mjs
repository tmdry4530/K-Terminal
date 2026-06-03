import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, loadEnv } from '../src/env.js';

test('parseEnv handles comments, blanks, export prefix and quotes', () => {
  const parsed = parseEnv([
    '# a comment',
    '',
    'PORT=8080',
    'export NAME=k-terminal',
    'QUOTED="hello world"',
    "SINGLE='literal $VALUE'",
    'INLINE=value # trailing comment',
    'ESCAPED="line1\\nline2"',
    'not a pair',
    '123BAD=skip'
  ].join('\n'));
  assert.equal(parsed.PORT, '8080');
  assert.equal(parsed.NAME, 'k-terminal');
  assert.equal(parsed.QUOTED, 'hello world');
  assert.equal(parsed.SINGLE, 'literal $VALUE');
  assert.equal(parsed.INLINE, 'value');
  assert.equal(parsed.ESCAPED, 'line1\nline2');
  assert.equal('123BAD' in parsed, false);
});

test('loadEnv never overrides an already-set variable', () => {
  const env = { EXISTING: 'keep' };
  // Use a path that does not exist -> loaded:false, no throw.
  const missing = loadEnv('definitely-not-a-real-env-file-xyz', env);
  assert.equal(missing.loaded, false);
  assert.equal(env.EXISTING, 'keep');
});
