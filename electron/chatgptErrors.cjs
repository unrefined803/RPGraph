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
    invalid_client: 'ChatGPT rejected the saved app registration. Sign out and sign in again.',
    model_not_found: 'This model is unavailable for the ChatGPT account. Select another model.',
  };
  // The parameter names the rejected request field; it is an identifier, not response text.
  const param = typeof body?.error?.param === 'string' && /^[\w.[\]-]{1,100}$/.test(body.error.param)
    ? body.error.param : undefined;
  if (param) messages.subscription_sharing_unsupported_capability += ` Affected parameter: ${param}.`;
  // Name the server's own code and explanation for unmapped failures; a bare
  // status does not tell the user which model or request field was rejected.
  const details = [status ? `HTTP ${status}` : undefined, /^[\w.-]{1,100}$/.test(code) ? code : undefined,
    param ? `parameter ${param}` : undefined].filter(Boolean).join(', ');
  const explanation = typeof body?.error?.message === 'string'
    ? body.error.message.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const receivedStatus = status;
  status ??= code === 'subscription_sharing_usage_limit_exceeded' ? 429
    : ['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'].includes(code) ? 503
    : ['subscription_sharing_user_not_eligible', 'subscription_sharing_route_not_supported',
      'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context'].includes(code) ? 403
    : code === 'subscription_sharing_invalid_user' ? 401 : 400;
  const error = new Error(messages[code] ?? (terminalRefreshCodes.has(code) ? messages.invalid_grant
    : `ChatGPT request failed${details ? ` (${details})` : ''}.${explanation ? ` ${explanation}` : ''}${
      receivedStatus === 401 ? ' Check your account and sign-in permissions.' : ''}`));
  error.code = code;
  error.status = status;
  error.requestId = requestId ?? undefined;
  error.param = param;
  return error;
}

module.exports = { chatgptError, terminalRefreshCodes };
