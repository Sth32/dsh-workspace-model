// Shared by the server and the generated block in client.js. Use the
// host-spelled registered paths, matching the native disk tree semantics.
export function effectiveRule(id, items, rules, legacySharing = false) {
  const byId = new Map(rules.map(rule => [rule.workspaceId, rule]))
  const local = byId.get(id)
  if (local && !local.inherit) return { rule: local }
  const pathKey = path => {
    if (typeof path !== 'string' || !path) return undefined
    const windows = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
    if (!windows && !path.startsWith('/')) return undefined
    return (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '')
  }
  const idOf = workspace => workspace.workspaceId ?? workspace.id
  const child = pathKey(items.find(workspace => idOf(workspace) === id)?.path)
  if (child == null) return {}
  let source, rule, length = -1
  for (const workspace of items) {
    const root = pathKey(workspace.path)
    const candidate = byId.get(idOf(workspace))
    if (!candidate || (candidate.inherit && !(candidate.childProvider && candidate.childModel)) || root == null || root.length <= length
      || child === root || !child.startsWith(root + '/')) continue
    source = workspace
    rule = candidate
    length = root.length
  }
  if (!source) return {}
  const share = !rule.inherit && (rule.shareWithChildren ?? legacySharing)
  if (share && rule.enabled) return { rule, source }
  if (rule.childProvider && rule.childModel) {
    return { rule: { enabled: true, provider: rule.childProvider, model: rule.childModel,
      reasoningEffort: rule.childReasoningEffort }, source, sourceKind: 'assigned' }
  }
  // An explicit nearer rule stops the search, even if it is not shared.
  return share ? { rule, source } : {}
}
