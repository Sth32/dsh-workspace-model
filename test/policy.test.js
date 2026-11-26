import {test} from 'node:test'
import assert from 'node:assert/strict'
import {withWorkspaceDefault} from '../policy.js'

const global = {provider:'d',model:'global'}
const a = {workspaceId:'a',enabled:true,provider:'d',model:'A',reasoningEffort:'high'}
const b = {workspaceId:'b',enabled:true,provider:'d',model:'B'}
function fixture(){
  const map = new Map(), warnings = []
  let id = 0
  const state = {rules:[a,b],valid:true}
  function make(id) {
    let model = global
    const agent = {session:{status:'idle',lastTurn:0,openTurnStartSeq:null},model:{current:()=>model,select(x){model=x}}}
    map.set(id,agent);return id
  }
  const create = withWorkspaceDefault(async request => {
    if(request.fail) throw new Error('native rejection')
    return {sessionId:request.sessionId && map.has(request.sessionId) ? request.sessionId : make(String(++id)),agentPreset:'standard'}
  },{rules:()=>state.rules,getAgent:id=>map.get(id),globalModel:()=>global,isBlank:a=>a.session.lastTurn===0,hasSelection:async a=>a.model.current()!==global,resolve:async()=>state.valid,warn:x=>warnings.push(x)})
  return {state,create,warnings,map}
}
test('two different workspace defaults, reasoning and native return preserved',async()=>{
 const f=fixture()
 for(const [workspaceId,want] of [['a',{provider:'d',model:'A',reasoningEffort:'high'}],['b',{provider:'d',model:'B'}],['unknown',global],[undefined,global]]){
  const r=await f.create({workspaceId})
  assert.equal(r.agentPreset,'standard')
  assert.deepEqual(f.map.get(r.sessionId).model.current(),want)
 }
})
test('turning off retains saved values but returns to global on a fresh or managed blank session',async()=>{
 const f=fixture(),r=await f.create({workspaceId:'a'})
 f.state.rules=[{...a,enabled:false},b]
 await f.create({workspaceId:'a',sessionId:r.sessionId})
 assert.deepEqual(f.map.get(r.sessionId).model.current(),global)
 const fresh=await f.create({workspaceId:'a'})
 assert.deepEqual(f.map.get(fresh.sessionId).model.current(),global)
 assert.equal(f.state.rules[0].model,'A')
})
test('manual choice and already-started sessions are not overwritten',async()=>{
 const f=fixture(),r=await f.create({workspaceId:'a'})
 const agent=f.map.get(r.sessionId), manual={provider:'d',model:'manual'}
 agent.model.select(manual);agent.session.lastTurn=1
 await f.create({workspaceId:'a',sessionId:r.sessionId})
 assert.deepEqual(agent.model.current(),manual)
})
test('unavailable choice preserves native default and original errors are not suppressed',async()=>{
 const f=fixture();f.state.valid=false
 const r=await f.create({workspaceId:'a'})
 assert.deepEqual(f.map.get(r.sessionId).model.current(),global)
 assert.equal(f.warnings.length,1)
 await assert.rejects(f.create({workspaceId:'a',fail:true}),/native rejection/)
})
