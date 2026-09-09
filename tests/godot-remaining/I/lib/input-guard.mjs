// No-real-input guard for task I acceptance runs.
//
// User rule (AGENTS.md, 2026-09-08): development tests must never take over the
// mouse, must never send real mouse/keyboard input, must never request pointer
// lock, and must never activate or raise a window. This module makes that rule
// executable instead of aspirational:
//   1. it scans the acceptance runner's own sources for forbidden input APIs;
//   2. it wraps any browser page so forbidden methods throw;
//   3. it carries a ledger that every evidence bundle must record.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INPUT_GUARD_FORMAT = 'craftmine.i.input-guard/1';

export const FORBIDDEN_PATTERNS = Object.freeze([
  { id: 'playwright-mouse', pattern: /\bpage\s*\.\s*mouse\b/, why: 'real mouse input' },
  { id: 'playwright-keyboard', pattern: /\bpage\s*\.\s*keyboard\b/, why: 'real keyboard input' },
  { id: 'playwright-click', pattern: /\bpage\s*\.\s*click\s*\(/, why: 'real click input' },
  { id: 'playwright-fill', pattern: /\bpage\s*\.\s*fill\s*\(/, why: 'real keyboard input' },
  { id: 'playwright-press', pattern: /\bpage\s*\.\s*press\s*\(/, why: 'real key input' },
  { id: 'locator-click', pattern: /\b(locator|frameLocator)\s*\([^)]*\)\s*\.\s*(click|fill|press|hover|type|check|selectOption)\s*\(/, why: 'real input via locator' },
  { id: 'pointer-lock', pattern: /requestPointerLock/, why: 'pointer lock request' },
  { id: 'focus-steal', pattern: /\b(browserWindow|win|window)\s*\.\s*(focus|show|moveTop)\s*\(/, why: 'window activation' },
  { id: 'always-on-top', pattern: /alwaysOnTop\s*[:=]\s*true/, why: 'window raised above the user' },
  { id: 'send-input-event', pattern: /sendInputEvent\s*\(/, why: 'synthetic OS input' },
  { id: 'robotjs', pattern: /\b(robotjs|nut-js|@nut-tree)/, why: 'OS level input library' },
  { id: 'child-input', pattern: /child_process[\s\S]{0,80}(SendKeys|WScript\.Shell)/, why: 'OS level input' },
]);

export const GUARDED_METHODS = Object.freeze(['mouse', 'keyboard', 'click', 'fill', 'press', 'hover', 'type', 'check', 'uncheck', 'selectOption', 'tap', 'dragAndDrop', 'focus']);

export function scanSources(dir, { skip = ['fixtures'] } = {}) {
  const findings = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || skip.includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(mjs|cjs|js|ts)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      // This module defines the patterns; it is not an input caller.
      if (text.includes('craftmine.i.input-guard/1')) continue;
      for (const rule of FORBIDDEN_PATTERNS) {
        const match = rule.pattern.exec(text);
        if (match) findings.push({ file: path.relative(dir, full), rule: rule.id, why: rule.why, excerpt: text.slice(Math.max(0, match.index - 40), match.index + 60).replace(/\s+/g, ' ') });
      }
    }
  };
  walk(dir);
  return findings;
}

export class InputGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputGuardError';
  }
}

// Wrap a browser page/context so that any real input call throws immediately.
// The returned object is the same page, so existing page-script based code keeps
// working while real input is impossible.
export function guardPage(page, ledger = createInputLedger()) {
  if (!page || typeof page !== 'object') throw new InputGuardError('guardPage needs a page object');
  const blocker = method => () => {
    ledger.blockedInputAttempts.push({ method, at: new Date().toISOString() });
    throw new InputGuardError(`real input is forbidden in acceptance runs: ${method}()`);
  };
  for (const method of GUARDED_METHODS) {
    const value = page[method];
    if (typeof value === 'function') { page[method] = blocker(method); continue; }
    // Nested input containers such as page.mouse.move / page.keyboard.press.
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) if (typeof value[key] === 'function') value[key] = blocker(`${method}.${key}`);
    }
  }
  return page;
}

export function createInputLedger() {
  return {
    format: INPUT_GUARD_FORMAT,
    inputEventsSent: 0,
    pointerLockRequests: 0,
    focusSteals: 0,
    windowActivations: 0,
    blockedInputAttempts: [],
    pointerLockDisabled: false,
    headless: null,
  };
}

export function markPointerLockDisabled(ledger) {
  ledger.pointerLockDisabled = true;
  return ledger;
}

export function assertNoInput(ledger) {
  if (!ledger) throw new InputGuardError('missing input ledger');
  const violations = [];
  if (ledger.inputEventsSent !== 0) violations.push(`inputEventsSent=${ledger.inputEventsSent}`);
  if (ledger.pointerLockRequests !== 0) violations.push(`pointerLockRequests=${ledger.pointerLockRequests}`);
  if (ledger.focusSteals !== 0) violations.push(`focusSteals=${ledger.focusSteals}`);
  if (ledger.windowActivations !== 0) violations.push(`windowActivations=${ledger.windowActivations}`);
  if (ledger.blockedInputAttempts?.length) violations.push(`blockedInputAttempts=${ledger.blockedInputAttempts.length}`);
  if (violations.length) throw new InputGuardError(`acceptance run violated the no-input rule: ${violations.join(', ')}`);
  return true;
}

export function runnerRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}
