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
export function withWorkspaceDefault(create, {rules, legacySharing = () => false, workspaces = () => [], getAgent, globalModel, resolve, warn, isBlank, observeSelection, loadOrigin = async () => undefined, saveOrigin = async () => {}}) {
  const managed = new WeakMap()
  return async function (request, ...args) {
    // Snapshot when the request is accepted; a later save affects the next request.
    const requested = request?.workspaceId
    let rule
    if (requested != null) {
      try {
        const choices = rules(), legacy = legacySharing()
        const sharing = legacy || choices.some(choice => choice.shareWithChildren || (choice.childProvider && choice.childModel))
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
      if (!isBlank(agent)) return result
      const requestedBlank = request.sessionId === result.sessionId
      const origin = requestedBlank ? managed.get(agent) ?? await loadOrigin(result.sessionId) : undefined
      if (!rule?.enabled && !origin) return result
      const observed = requestedBlank ? await observeSelection(agent) : undefined
      const current = agent.model.current()
      const ours = origin?.workspaceId === requested && observed?.seq != null &&
        origin.seq === observed.seq && sameModel(origin.selection, current)
      // A legacy/unmarked, newly hand-picked, or moved selection is not ours.
      if (observed?.hasRequest || (observed?.seq != null && !ours) || (!rule?.enabled && !ours)) return result
      const selection = rule?.enabled ? modelOf(rule) : globalModel()
      if (!selection || !await resolve(selection)) {
        warn('Workspace default is unavailable; retaining the native model selection')
        return result
      }
      // Native choices can change during catalog/observation I/O. Do not use an
      // old snapshot even if a user switched away and then back to the same tuple.
      if (observed) {
        const latest = await observeSelection(agent)
        if (latest.seq !== observed.seq || latest.hasRequest) return result
      }
      const now = agent.model.current()
      if (now !== current && (now || current) && !sameModel(now, current)) return result
      if (!isBlank(agent)) return result
      const seq = agent.session.seq
      agent.model.select(selection)
      // AgentModel.select is synchronous and does not append a duplicate.
      if (agent.session.seq === seq + 1) {
        const provenance = { workspaceId: requested, seq, selection }
        managed.set(agent, provenance)
        await saveOrigin(result.sessionId, provenance)
      }
    } catch (error) {
      warn('Workspace default was not applied: ' + String(error))
    }
    return result
  }
}
