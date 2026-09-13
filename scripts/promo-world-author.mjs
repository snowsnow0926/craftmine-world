#!/usr/bin/env node
// Project entry with the real product verifier attached to Codex's world tools.
import path from 'node:path';
import {main} from './codex-world-author.mjs';
import {closeServices} from './lib/promo-world-services.mjs';
import {redact} from './lib/codex-app-server.mjs';

const args = process.argv.slice(2);
if (args.includes('--services')) throw Error('PROMO_SERVICES_ARE_HOST_OWNED');
if (['turn', 'doctor'].includes(args[0])) args.push('--services', path.join(import.meta.dirname, 'lib/promo-world-services.mjs'));
try { await main(args); }
catch (error) {
  process.stderr.write(JSON.stringify({status: 'error', code: redact(error.message), diagnostic: redact(error.diagnostic ?? null)}) + '\n');
  process.exitCode = 1;
} finally { await closeServices(); }
