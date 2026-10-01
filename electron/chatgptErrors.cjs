const terminalRefreshCodes = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired',
  'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused',
]);

function chatgptError(status, body, requestId) {
  const code = typeof body?.error?.code === 'string' ? body.error.code
    : typeof body?.error === 'string' ? body.error : undefined;
  const messages = {
    subscription_sharing_usage_limit_exceeded: 'ChatGPT usage limit reached. Open Manage usage to review your plan or app limit.',
    subscription_sharing_user_not_eligible: 'ChatGPT plan usage is unavailable for this account or workspace.',
    subscription_sharing_unsupported_capability: 'This request uses a capability unavailable through ChatGPT plan usage.',
    subscription_sharing_invalid_user: 'ChatGPT could not validate this session. Sign in again if access has been revoked.',
    subscription_sharing_usage_unavailable: 'ChatGPT usage availability could not be checked. Please retry later.',
    subscription_sharing_user_unavailable: 'ChatGPT account information is temporarily unavailable. Please retry later.',
    subscription_sharing_route_not_supported: 'This request route is unavailable through ChatGPT plan usage.',
    invalid_grant: 'The ChatGPT session can no longer be renewed. Sign in again.',
  };
  status ??= code === 'subscription_sharing_usage_limit_exceeded' ? 429
    : ['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'].includes(code) ? 503
    : ['subscription_sharing_user_not_eligible', 'subscription_sharing_route_not_supported',
      'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context'].includes(code) ? 403
    : code === 'subscription_sharing_invalid_user' ? 401 : 400;
  const error = new Error(messages[code] ?? (terminalRefreshCodes.has(code) ? messages.invalid_grant
    : `ChatGPT request failed (HTTP ${status}).${status === 401 ? ' Check your account and sign-in permissions.' : ''}`));
  error.code = code;
  error.status = status;
  error.requestId = requestId ?? undefined;
  error.param = typeof body?.error?.param === 'string' ? body.error.param : undefined;
  return error;
}

module.exports = { chatgptError, terminalRefreshCodes };
