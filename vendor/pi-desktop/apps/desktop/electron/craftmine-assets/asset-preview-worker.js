// Fixed decoder-only entry. The build emits this as a sibling of Main index.js.
// No Electron, project source execution, filesystem paths or window APIs.
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { previewAsset } from './preview-service.mjs';

if (isMainThread || !parentPort || !workerData?.previewRequest) {
  throw Error('ASSET_PREVIEW_WORKER_REQUEST_REQUIRED');
}
try {
  parentPort.postMessage({ ok: true, result: previewAsset(workerData.previewRequest) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error?.message || error) });
} finally {
  parentPort.close();
}
