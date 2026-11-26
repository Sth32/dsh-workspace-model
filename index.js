import z from '@deepseek-ai/schemastery'
import { withWorkspaceDefault } from './policy.js'

export const name = 'workspace-model-defaults'
export const inject = ['settings', 'sessionController', 'agents', 'agentDefaultModel', 'llm', 'sessionQuery', 'workspaceRegistry']
const rule = z.object({
  workspaceId: z.string().required(),
  enabled: z.boolean().default(false),
  inherit: z.boolean().default(false),
  shareWithChildren: z.boolean(),
  provider: z.string().default(''),
  model: z.string().default(''),
  reasoningEffort: z.string().default(''),
})
export const Config = z.object({
  rules: z.array(rule).default([]).volatile(),
  inheritEnabled: z.boolean().default(false).volatile(),
})
export function apply(ctx, config) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
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
    async hasSelection(agent) {
      const observation = await ctx.sessionQuery.observeSession(agent.id)
      try { return observation.events.some(event => event.type === 'model/selection' || event.type === 'request/header') }
      finally { observation[Symbol.dispose]() }
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
