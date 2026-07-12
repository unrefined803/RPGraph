// The Phone Apps node has no graph ports. It only stores the provider
// selection for direct phone apps; those apps call the LLM outside of
// graph runs and light the node up through the runtime patching helpers.
export async function executePhoneAppsNode() {
  return '';
}
