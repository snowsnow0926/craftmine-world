import type { CodexConnectionRequest, CodexConnectionStatus } from '@pi-desktop/shared';
export class CodexConnection {
  constructor(options: { cwd: string; pick: () => Promise<string | undefined>; openExternal: (url: string) => Promise<void> });
  invoke(request: CodexConnectionRequest): Promise<CodexConnectionStatus>;
  dispose(): Promise<void>;
}
