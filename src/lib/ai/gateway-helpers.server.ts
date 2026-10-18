import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { createGatewayRunIdFetch } from "./run-id.server.ts";
export {
  createGatewayRunIdFetch,
  getGatewayRunId,
  getGatewayResponseHeaders,
  withGatewayRunIdHeader,
} from "./run-id.server.ts";

export function createGatewayProvider(
  gatewayApiKey: string,
  initialRunId: string | undefined,
  options: { baseURL: string; structuredOutputs?: boolean },
) {
  const runIdFetch = createGatewayRunIdFetch(initialRunId);

  const provider = createOpenAICompatible({
    name: "gateway",
    baseURL: `${options.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`,
    supportsStructuredOutputs: options?.structuredOutputs ?? false,
    headers: {
      "Lovable-API-Key": gatewayApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });

  return Object.assign(provider, {
    getRunId: runIdFetch.getRunId,
    waitForRunId: runIdFetch.waitForRunId,
  });
}
