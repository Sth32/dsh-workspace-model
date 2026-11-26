import {test} from 'node:test'
import assert from 'node:assert/strict'
import {effectiveRule} from '../inheritance.js'
const ws=(id,path)=>({workspaceId:id,path})
const root=ws('root','/repo'), child=ws('child','/repo/app'), leaf=ws('leaf','/repo/app/lib')
const custom=workspaceId=>({workspaceId,enabled:true,model:workspaceId})
test('inherits the nearest configured ancestor, and never infers from display grouping',()=>{
 const list=[root,child,leaf,ws('sibling','/repo-app/lib'),ws('virtual','/elsewhere')]
 const r=custom('root'), c=custom('child')
 assert.deepEqual(effectiveRule('leaf',list,[r,c],true),{rule:c,source:child})
 assert.deepEqual(effectiveRule('leaf',list,[r,{...c,inherit:true}],true),{rule:r,source:root})
 assert.deepEqual(effectiveRule('sibling',list,[r],true),{})
 assert.deepEqual(effectiveRule('virtual',list,[r],true),{})
 assert.deepEqual(effectiveRule('missing',list,[r],true),{})
})
test('legacy global overrides inheritance; local custom survives turning the feature off',()=>{
 const list=[root,child,leaf], r=custom('root'), c={...custom('child'),enabled:false}, l=custom('leaf')
 assert.deepEqual(effectiveRule('child',list,[r,c],true),{rule:c})
 assert.deepEqual(effectiveRule('leaf',list,[r,c],true),{rule:c,source:child})
 assert.deepEqual(effectiveRule('leaf',list,[r,c,l],false),{rule:l})
 assert.deepEqual(effectiveRule('leaf',list,[r,c],false),{})
})
test('handles registered Windows drive/UNC roots and POSIX backslashes',()=>{
 for(const [a,b,expected] of [
  ['C:\\','C:/repo/Child',true], ['C:\\src','C:\\src2\\Child',false],
  ['\\\\host\\share','\\\\host\\share\\Child',true],
  ['/','/src',true], ['/a\\b','/a/b/child',false]
 ]){
  const source=ws('a',a),rule=custom('a')
  assert.deepEqual(effectiveRule('b',[source,ws('b',b)],[rule],true),expected?{rule,source}:{})
 }
})

test('sharing is independent per branch and a nearer unshared rule blocks a grandparent',()=>{
 const extra=ws('extra','/different'), sub=ws('sub','/different/sub')
 const list=[root,child,leaf,extra,sub]
 const r={...custom('root'),shareWithChildren:true}, x={...custom('extra'),shareWithChildren:false}
 const c={...custom('child'),shareWithChildren:false}
 assert.deepEqual(effectiveRule('child',list,[r,x]),{rule:r,source:root})
 assert.deepEqual(effectiveRule('sub',list,[r,x]),{})
 assert.deepEqual(effectiveRule('leaf',list,[r,c,x]),{})
 assert.deepEqual(effectiveRule('leaf',list,[r,{...c,shareWithChildren:true},x]),{rule:{...c,shareWithChildren:true},source:child})
 assert.deepEqual(effectiveRule('leaf',list,[r,{...c,inherit:true},x]),{rule:r,source:root})
})

test('upgrades preserve legacy rules, but explicit scoped off wins',()=>{
 const list=[root,child], legacy=custom('root')
 assert.deepEqual(effectiveRule('child',list,[legacy],true),{rule:legacy,source:root})
 assert.deepEqual(effectiveRule('child',list,[{...legacy,shareWithChildren:false}],true),{})
 assert.deepEqual(effectiveRule('child',list,[legacy],false),{})
})
