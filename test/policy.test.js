import {test} from 'node:test'
import assert from 'node:assert/strict'
import {withWorkspaceDefault} from '../policy.js'

const global = {provider:'d',model:'global'}
const a = {workspaceId:'a',enabled:true,provider:'d',model:'A',reasoningEffort:'high'}
const b = {workspaceId:'b',enabled:true,provider:'d',model:'B'}
function fixture(){
  const map = new Map(), warnings = [], origins = new Map()
  let id = 0
  const state = {rules:[a,b],valid:true,inherit:false,workspaces:[]}
  function make(id, stored) {
    let model = stored?.model.current() ?? global
    const session = {status:'idle',lastTurn:0,openTurnStartSeq:null, seq:0, ...stored?.session}
    const agent = {session,model:{current:()=>model,select(x){
      if (session.modelSeq != null && JSON.stringify(x) === JSON.stringify(model)) return
      model=x;session.modelSeq=session.seq++
    }}}
    map.set(id,agent);return id
  }
  function wrap() {
    return withWorkspaceDefault(async request => {
      if(request.fail) throw new Error('native rejection')
      return {sessionId:request.sessionId && map.has(request.sessionId) ? request.sessionId : make(String(++id)),agentPreset:'standard'}
    },{rules:()=>state.rules,legacySharing:()=>state.inherit,workspaces:()=>state.workspaces,getAgent:id=>map.get(id),
      globalModel:()=>global,isBlank:a=>a.session.lastTurn===0,
      observeSelection:async a=>({seq:a.session.modelSeq,hasRequest:a.session.hasRequest}),
      loadOrigin:async id=>origins.get(id),saveOrigin:async(id,data)=>origins.set(id,data),
      resolve:async()=>state.valid,warn:x=>warnings.push(x)})
  }
  return {state,create:wrap(),warnings,map,origins,restart(){for(const [id,a] of map)make(id,a); this.create=wrap()}}

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

test('inherited choice resets a blank when the global switch is off, preserving manual edits', async () => {
 const f=fixture()
 f.state.inherit=true
 f.state.workspaces=[{id:'a',path:'/work/A'}, {id:'child',path:'/work/A/Child'}]
 const r=await f.create({workspaceId:'child'})
 assert.equal(f.map.get(r.sessionId).model.current().model,'A')
 f.state.inherit=false
 await f.create({workspaceId:'child',sessionId:r.sessionId})
 assert.deepEqual(f.map.get(r.sessionId).model.current(),global)
 f.map.get(r.sessionId).model.select({provider:'d',model:'manual'})
 f.state.inherit=true
 await f.create({workspaceId:'child',sessionId:r.sessionId})
 assert.equal(f.map.get(r.sessionId).model.current().model,'manual')
})

test('separate child assignment is used even when no branch shares the parent model', async () => {
 const f=fixture()
 f.state.workspaces=[{id:'a',path:'/A'}, {id:'child',path:'/A/Child'}, {id:'other',path:'/Other'}]
 f.state.rules=[{...a,shareWithChildren:false,childProvider:'d',childModel:'child-model',childReasoningEffort:'low'}]
 for(const [workspaceId,selection] of [['a',{provider:'d',model:'A',reasoningEffort:'high'}],['child',{provider:'d',model:'child-model',reasoningEffort:'low'}],['other',global]]){
  const r=await f.create({workspaceId})
  assert.deepEqual(f.map.get(r.sessionId).model.current(),selection)
 }
})

test('switching a managed blank through share, separate, clear and local override keeps routes isolated', async () => {
 const f=fixture()
 const child={workspaceId:'child',path:'C:\\Work\\A\\child'}
 f.state.workspaces=[{id:'a',path:'C:\\Work\\A'},child,{id:'b',path:'C:\\Work\\AB'}]
 const split={...a,shareWithChildren:false,childProvider:'child-provider',childModel:'child-model',childReasoningEffort:'low'}
 f.state.rules=[split,b]
 const parent=await f.create({workspaceId:'a'})
 const blank=await f.create({workspaceId:child.workspaceId})
 const actual = id => f.map.get(id).model.current()
 assert.deepEqual(actual(parent.sessionId),{provider:'d',model:'A',reasoningEffort:'high'})
 assert.deepEqual(actual(blank.sessionId),{provider:'child-provider',model:'child-model',reasoningEffort:'low'})
 const reopen=async (rule,want) => {
   f.state.rules=rule
   await f.create({workspaceId:child.workspaceId,sessionId:blank.sessionId})
   assert.deepEqual(actual(blank.sessionId),want)
   assert.deepEqual(actual(parent.sessionId),{provider:'d',model:'A',reasoningEffort:'high'})
 }
 await reopen([{...split,shareWithChildren:true},b],{provider:'d',model:'A',reasoningEffort:'high'})
 await reopen([{...split,childProvider:'',childModel:''},b],global)
 await reopen([split,b,{workspaceId:'child',enabled:true,provider:'local',model:'other'}],{provider:'local',model:'other'})
 await reopen([split,b,{workspaceId:'child',enabled:false}],global)
 await reopen([split,b,{workspaceId:'child',enabled:false,inherit:true}],{provider:'child-provider',model:'child-model',reasoningEffort:'low'})
})

test('preserves a manual edit on the same still-blank session after changing the parent rule', async () => {
 const f=fixture()
 const r=await f.create({workspaceId:'a'})
 const agent=f.map.get(r.sessionId)
 const manual={provider:'other',model:'review',reasoningEffort:'medium'}
 agent.model.select(manual)
 f.state.rules=[{...a,provider:'replacement'},b]
 assert.equal(agent.session.lastTurn,0)
 assert.equal((await f.create({workspaceId:'a',sessionId:r.sessionId})).sessionId,r.sessionId)
 assert.deepEqual(agent.model.current(),manual)
})

test('an unsupported own model goes to native default, not the separately assigned child model', async () => {
 const f=fixture()
 f.state.valid=false
 f.state.workspaces=[{id:'a',path:'/A'},{id:'child',path:'/A/Child'}]
 f.state.rules=[{...a,shareWithChildren:false,childProvider:'child',childModel:'review'}]
 const {sessionId}=await f.create({workspaceId:'a'})
 assert.deepEqual(f.map.get(sessionId).model.current(),global)
 assert.match(f.warnings[0],/unavailable/)
})

test('after restart, reusing a marked draft updates only the plugin-owned selection', async () => {
 const f=fixture()
 const prior=await f.create({workspaceId:'a'})
 const id=prior.sessionId
 const changed={...a,provider:'fresh',model:'parent',reasoningEffort:'medium'}
 f.state.rules=[changed,b]
 f.restart()
 assert.equal((await f.create({workspaceId:'a',sessionId:id})).sessionId,id)
 assert.deepEqual(f.map.get(id).model.current(),{provider:'fresh',model:'parent',reasoningEffort:'medium'})
 const agent=f.map.get(id)
 agent.model.select({provider:'elsewhere',model:'other'})
 agent.model.select({provider:'fresh',model:'parent',reasoningEffort:'medium'})
 // Same tuple as the marker but a newer event; the model was chosen by hand.
 f.state.rules=[a,b]
 f.restart()
 await f.create({workspaceId:'a',sessionId:id})
 assert.deepEqual(f.map.get(id).model.current(),{provider:'fresh',model:'parent',reasoningEffort:'medium'})
})

test('a restored unmarked legacy draft and a draft moved out of its recorded workspace retain their selection', async () => {
 const f=fixture()
 const first=(await f.create({workspaceId:'a'})).sessionId
 const moved=(await f.create({workspaceId:'a'})).sessionId
 f.origins.delete(first)
 f.state.rules=[{...a,model:'updated'},b]
 f.restart()
 await f.create({workspaceId:'a',sessionId:first})
 await f.create({workspaceId:'b',sessionId:moved})
 for (const id of [first,moved]) assert.equal(f.map.get(id).model.current().model,'A')
})
