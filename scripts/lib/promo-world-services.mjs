import path from 'node:path';
import {startPromoGodotCheckService} from './promo-godot-check-service.mjs';

let checks = null;

export async function createServices({data}) {
  if (checks) throw Error('PROMO_CHECK_SERVICE_ALREADY_STARTED');
  checks = await startPromoGodotCheckService({directory: path.join(data, 'runtime-checks')});
  return {verifier: checks.verifier, stop: closeServices};
}

export async function closeServices() {
  const current = checks; checks = null;
  await current?.close();
}
