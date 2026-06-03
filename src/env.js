import fs from 'node:fs';

// Minimal, dependency-free .env loader.
// Rationale: `npm start` runs `node src/server.js` with no `--env-file`, so without this
// the .env file is silently ignored on local runs (only docker-compose's env_file worked).
// Behavior:
// - Real process environment always wins (never override an already-set variable).
// - Supports KEY=VALUE, blank lines, # comments, `export KEY=VALUE`, and quoted values.
// - Missing file is not an error (returns { loaded: false }).
export function parseEnv(raw) {
  const result = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf('=');
    if (eq < 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
      }
    } else {
      const inlineComment = value.indexOf(' #');
      if (inlineComment >= 0) value = value.slice(0, inlineComment).trim();
    }
    result[key] = value;
  }
  return result;
}

export function loadEnv(envPath, env = process.env) {
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { loaded: false, count: 0 };
    throw error;
  }
  const parsed = parseEnv(raw);
  let count = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (key in env) continue; // real environment takes precedence
    env[key] = value;
    count += 1;
  }
  return { loaded: true, count };
}
