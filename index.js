import z from '@deepseek-ai/schemastery'
import { withWorkspaceDefault } from './policy.js'

export const name = 'workspace-model-defaults'
export const inject = ['settings', 'sessionController', 'agents', 'agentDefaultModel', 'llm', 'sessionQuery', 'workspaceRegistry', 'storageDomain']
const rule = z.object({
  workspaceId: z.string().required(),
  enabled: z.boolean().default(false),
  inherit: z.boolean().default(false),
  shareWithChildren: z.boolean(),
  childProvider: z.string().default(''),
  childModel: z.string().default(''),
  childReasoningEffort: z.string().default(''),
  provider: z.string().default(''),
  model: z.string().default(''),
  reasoningEffort: z.string().default(''),
})
export const Config = z.object({
  rules: z.array(rule).default([]).volatile(),
  inheritEnabled: z.boolean().default(false).volatile(),
})
// This is plugin-owned metadata, not a change to the native model event or
// workspace config. Keep only the workspace, model tuple and event sequence.
function parseOrigin(value) {
  const selection = value?.selection
  if (typeof value?.workspaceId !== 'string' || !Number.isSafeInteger(value.seq) || value.seq < 0 ||
    typeof selection?.provider !== 'string' || typeof selection.model !== 'string' ||
    (selection.reasoningEffort !== undefined && typeof selection.reasoningEffort !== 'string')) {
    throw new Error('Invalid workspace draft origin')
  }
  return value
}
const originDomain = {
  name: 'workspace_model_drafts',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: { origins: { valueSchema: { parse: parseOrigin } } },
}
export function apply(ctx, config) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  const originStore = ctx.storageDomain.open(originDomain).catch(error => {
    ctx.logger.warn('Workspace model draft metadata unavailable: ' + String(error))
  })
  ctx.effect(() => () => originStore.then(domain => domain?.close()))
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start' || event.data.turn !== 1) return
    void originStore.then(domain => domain?.table('origins').delete(session.id)).catch(error => {
      ctx.logger.warn('Workspace model draft cleanup failed: ' + String(error))
    })
  })
  const controller = ctx.sessionController
  const original = controller.create
  const wrapped = withWorkspaceDefault(original, {
    rules: () => config.rules.get(),
    legacySharing: () => config.inheritEnabled.get(),
    workspaces: () => ctx.workspaceRegistry.list(),
    getAgent: id => ctx.agents.get(id),
    isBlank(agent) {
      const boundary = ctx.agents.turnBoundaryOf(agent.session)
      return boundary.lastTurn === 0 && boundary.openTurnStartSeq === null
    },
    async observeSelection(agent) {
      const observation = await ctx.sessionQuery.observeSession(agent.id)
      try {
        return { seq: observation.events.findLast(event => event.type === 'model/selection')?.seq,
          hasRequest: observation.events.some(event => event.type === 'request/header') }
      } finally { observation[Symbol.dispose]() }
    },
    async loadOrigin(id) {
      return (await originStore)?.table('origins').get(id)
    },
    async saveOrigin(id, origin) {
      try { await (await originStore)?.table('origins').put(id, origin) }
      catch (error) { ctx.logger.warn('Workspace model selection applied, but draft metadata was not saved: ' + String(error)) }
    },
    globalModel: () => ctx.agentDefaultModel.currentSelection(),
    async resolve(selection) {
      const result = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
      return !!result && (!selection.reasoningEffort || !!result.reasoning?.efforts.some(e => e.id === selection.reasoningEffort))
    },
    warn: msg => ctx.logger.warn(msg),
  })
  ctx.effect(() => {
    controller.create = wrapped
    return () => { if (controller.create === wrapped) controller.create = original }
  })
}
