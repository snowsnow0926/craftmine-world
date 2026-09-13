/** Only these host-owned connection operations cross preload; never raw RPC. */
export type CodexConnectionRequest = {
  action: "detect" | "pick" | "verify" | "login" | "status" | "cancel" | "openLogin" | "instructions";
  path?: string;
};
export type CodexConnectionStatus = {
  code: string;
  path?: string;
  version?: string;
  requiredVersion: string;
  model: "gpt-6-astra";
  effort: "xhigh";
  account?: { type: string; email?: string; plan?: string };
  loginPending?: boolean;
  candidates?: Array<{path: string; version?: string; compatible: boolean}>;
};
