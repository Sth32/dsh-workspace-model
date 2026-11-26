import { effectiveRule } from './inheritance.js'
export const entry = 'workspace-model-defaults'
export function modelOf(rule) {
  if (!rule?.provider || !rule?.model) return undefined
  return { provider: rule.provider, model: rule.model, ...(rule.reasoningEffort ? { reasoningEffort: rule.reasoningEffort } : {}) }
}
export function sameModel(a, b) {
  return a != null && b != null && a.provider === b.provider && a.model === b.model && (a.reasoningEffort || '') === (b.reasoningEffort || '')
}

/**
 * Extend native creation only after authorization/creation have succeeded.
 * Never change the caller's contract or replace the global default writer.
 */
export function withWorkspaceDefault(create, {rules, legacySharing = () => false, workspaces = () => [], getAgent, globalModel, resolve, warn, isBlank, hasSelection}) {
  const managed = new WeakMap()
  return async function (request, ...args) {
    // Snapshot when the request is accepted; a later save affects the next request.
    const requested = request?.workspaceId
    let rule
    if (requested != null) {
      try {
        const choices = rules(), legacy = legacySharing()
        const sharing = legacy || choices.some(choice => choice.shareWithChildren)
        rule = effectiveRule(requested, sharing ? workspaces() : [], choices, legacy).rule
      } catch (error) {
        warn('Workspace default lookup failed: ' + String(error))
      }
    }
    const result = await create.call(this, request, ...args)
    if (requested == null) return result

    try {
      const agent = getAgent(result.sessionId)
      if (!agent) return result
      const prior = managed.get(agent)
      const previous = prior?.workspaceId === requested ? prior.selection : undefined
      if (!rule?.enabled && !previous) return result
      const requestedBlank = request.sessionId === result.sessionId
      const current = agent.model.current()
      // Native only reuses blank sessions. Still preserve an explicit model edit on a blank
      // and never touch a retained agent whose choice we did not set.
      if (requestedBlank && (previous ? !sameModel(previous, current) : await hasSelection(agent))) return result
      const selection = rule?.enabled ? modelOf(rule) : globalModel()
      if (!selection || !await resolve(selection)) {
        warn('Workspace default is unavailable; retaining the native model selection')
        return result
      }
      // Preserve selections made while catalog validation was in flight.
      const now = agent.model.current()
      if (now !== current && (now || current) && !sameModel(now, current)) return result
      if (!isBlank(agent)) return result
      agent.model.select(selection)
      managed.set(agent, { workspaceId: requested, selection })
    } catch (error) {
      warn('Workspace default was not applied: ' + String(error))
    }
    return result
  }
}
