/**
 * LLM error helper — translates raw Azure OpenAI / OpenAI SDK errors
 * into clear, actionable error messages for the user.
 */

interface SDKError {
  status?: number;
  statusCode?: number;
  code?: string;
  message?: string;
  type?: string;
  error?: { code?: string; message?: string; type?: string };
}

/**
 * Wrap an LLM API error with a clear, actionable message.
 * Re-throws a new Error with guidance on how to fix the issue.
 * If the error is not a recognized LLM error, re-throws it unchanged.
 */
export function wrapLLMError(error: unknown): never {
  const raw = error as SDKError;
  const status = raw.status ?? raw.statusCode;
  const code =
    raw.code ?? raw.error?.code ?? raw.type ?? raw.error?.type ?? "";
  const message = error instanceof Error ? error.message : String(error);
  const lowerMsg = message.toLowerCase();
  const lowerCode = code.toLowerCase();

  // 401 — Invalid API key / expired key
  if (
    status === 401 ||
    lowerCode === "invalid_api_key" ||
    lowerMsg.includes("incorrect api key")
  ) {
    throw new Error(
      `Azure OpenAI authentication failed (HTTP ${status ?? 401}).\n` +
        `  → Your LLM_API_KEY may be invalid or expired.\n` +
        `  → Verify the key in Azure Portal > your OpenAI resource > Keys and Endpoint.\n` +
        `  → Update LLM_API_KEY in your .env file and restart the agent.`
    );
  }

  // 403 — Network restriction / IP filter / VNet
  if (status === 403 || lowerMsg.includes("access denied")) {
    throw new Error(
      `Azure OpenAI access forbidden (HTTP 403).\n` +
        `  → Your Azure OpenAI resource may have network restrictions (VNet/Firewall/Private Endpoint).\n` +
        `  → Ensure your IP is allowed in Azure Portal > your OpenAI resource > Networking.\n` +
        `  → If using a private endpoint, verify you are on the correct network.`
    );
  }

  // 429 — Rate limit / quota exceeded
  if (
    status === 429 ||
    lowerCode === "rate_limit_exceeded" ||
    lowerMsg.includes("rate limit")
  ) {
    throw new Error(
      `Azure OpenAI rate limit exceeded (HTTP 429).\n` +
        `  → You've hit the token-per-minute or request-per-minute quota.\n` +
        `  → Wait a moment and try again, or increase your quota in Azure Portal.\n` +
        `  → Consider using a different deployment or reducing report scope.`
    );
  }

  // 404 — Deployment not found
  if (
    status === 404 ||
    lowerCode === "deploymentnotfound" ||
    lowerMsg.includes("deployment for this resource does not exist")
  ) {
    throw new Error(
      `Azure OpenAI model deployment not found (HTTP 404).\n` +
        `  → The model "${lowerMsg.match(/'([^']+)'/)?.[1] ?? "configured in LLM_MODEL"}" may not be deployed.\n` +
        `  → Check your deployments in Azure Portal > your OpenAI resource > Model deployments.\n` +
        `  → Ensure LLM_MODEL in .env matches an active deployment name.`
    );
  }

  // 408 / ETIMEDOUT / ECONNREFUSED — Network timeout
  if (
    status === 408 ||
    lowerCode === "etimedout" ||
    lowerCode === "econnrefused" ||
    lowerMsg.includes("etimedout") ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("enotfound")
  ) {
    throw new Error(
      `Cannot reach Azure OpenAI endpoint (${code || "network error"}).\n` +
        `  → Check your internet connection and VPN status.\n` +
        `  → Verify LLM_ENDPOINT in .env is correct.\n` +
        `  → If the endpoint is behind a firewall, ensure your network allows outbound HTTPS.`
    );
  }

  // 503 — Service unavailable / Azure outage
  if (status === 503 || lowerMsg.includes("temporarily unable")) {
    throw new Error(
      `Azure OpenAI service is temporarily unavailable (HTTP 503).\n` +
        `  → This is usually a transient Azure issue. Wait a moment and try again.\n` +
        `  → Check Azure status at: https://status.azure.com`
    );
  }

  // Content filter violation
  if (
    lowerCode === "content_filter" ||
    lowerMsg.includes("content management policy") ||
    lowerMsg.includes("content filter")
  ) {
    throw new Error(
      `Azure OpenAI content filter triggered.\n` +
        `  → The request or work item data triggered Azure's content management policy.\n` +
        `  → Review the work item descriptions for content that may be filtered.\n` +
        `  → You can adjust content filtering in Azure Portal > your OpenAI resource > Content filters.`
    );
  }

  // Context length / token limit exceeded
  if (
    lowerCode === "context_length_exceeded" ||
    lowerMsg.includes("maximum context length")
  ) {
    throw new Error(
      `Azure OpenAI token limit exceeded.\n` +
        `  → The work item data is too large for the model's context window.\n` +
        `  → Try narrowing the reporting period or reducing the number of work items.\n` +
        `  → Consider using a model with a larger context window (e.g., gpt-4.1).`
    );
  }

  // 500 — Internal server error
  if (status === 500) {
    throw new Error(
      `Azure OpenAI internal server error (HTTP 500).\n` +
        `  → This is an issue on Azure's side. Wait a moment and try again.\n` +
        `  → If the problem persists, check https://status.azure.com`
    );
  }

  // Not a recognized LLM error — re-throw unchanged
  throw error;
}
