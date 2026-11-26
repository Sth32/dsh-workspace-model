// Run against an isolated DSH Web host; see e2e/README.md.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const url = process.env.DSH_TEST_URL
const run = process.env.DSH_TEST_RUN || 'matrix'
const stale = process.env.DSH_TEST_STALE_PROBE !== '0'
const better = process.env.DSH_TEST_BETTER === '1'
const restart = process.env.DSH_TEST_PHASE === 'restart'
const expected = new Map()
const general = ['test-models','mock-general','General',null,null]
const parent = ['parent-models','mock-parent','Parent','medium','Medium']
const child = ['test-models','mock-review','Review','low','Low']
const local = ['test-models','mock-coding','Coding','high','High']
const [P,C,L,O] = ['MatrixRoot','MatrixChild','MatrixLeaf','MatrixOther']

async function main() {
  assert(url && process.env.DSH_TEST_MOCK_LOG && (!stale || process.env.DSH_TEST_BROWSER_STATE), 'use e2e/run.sh to set up the fixture')
  const browser = await chromium.launch({executablePath: process.env.DSH_TEST_CHROMIUM || undefined})
  const state = process.env.DSH_TEST_BROWSER_STATE
  const page = await browser.newPage({...(restart && stale && state ? {storageState:state}:{}),locale:'zh-CN', viewport:{width:1300,height:1050}})
  page.setDefaultTimeout(10000)
  const d = page.getByRole('dialog',{name:'工作区默认模型'})
  const mode = d.getByLabel('默认规则')
  const checked = d.getByRole('checkbox',{name:'子工作区继承当前配置'})
  const group = d.getByRole('group',{name:'子工作区默认模型'})
  const row = n => page.locator(better ? '.bw-container-row[role=treeitem]' : '[role=treeitem][data-row-key^="workspace:"]')
    .filter({has:page.getByText(n,{exact:true})}).first()
  const title = n => row(n).getByText(n,{exact:true})
  const newButton = n => better ? row(n).locator('button.bw-row-btn') : page.getByRole('button',{name:'在“'+n+'”中新建会话',exact:true})
  const modelButton = () => page.getByRole('button',{name:/^选择模型，当前/})
  async function expand(p,c) {
    if (!await row(c).isVisible()) await title(p).click()
    await row(c).waitFor()
  }
  async function open(n) {
    await title(n).hover()
    const button = page.getByRole('button',{name:'设置 '+n+' 的默认模型',exact:true})
    await button.evaluate(el=>el.click())
    await d.waitFor()
  }
  async function save() {
    await d.getByRole('button',{name:'保存',exact:true}).click()
    await d.waitFor({state:'hidden'})
  }
  const cancel = () => d.getByRole('button',{name:'取消',exact:true}).click()
  async function choose(container, prefix, spec) {
    await container.getByLabel(prefix+'提供方',{exact:true}).selectOption(spec?.[0] ?? '')
    if (!spec) return
    await container.getByLabel(prefix+'模型',{exact:true}).selectOption(spec[1])
    if (spec[3]) await container.getByLabel(prefix+'思考等级',{exact:true}).selectOption(spec[3])
  }
  async function openNew(n) {
    await title(n).hover()
    await newButton(n).click()
  }
  async function assertDraft(n,spec) {
    await page.getByRole('button',{name:'选择工作区',exact:true}).filter({hasText:n}).waitFor()
    if (process.env.DSH_TEST_AGENT_PRESET === 'ptc') {
      await page.getByRole('button').filter({hasText:/^PTC 模式$/}).waitFor()
    }
    const name = '选择模型，当前 '+spec[2]+(spec[4]?'，推理等级 '+spec[4]:'')
    try { await page.getByRole('button',{name,exact:true}).waitFor({timeout:5000}) }
    catch (error) {
      console.error('DRAFT',n,'expected',name,'observed',await modelButton().evaluateAll(xs=>xs.map(el=>el.ariaLabel)))
      throw error
    }
  }
  async function send(n,spec,key) {
    await assertDraft(n,spec)
    const marker = 'dshwm-'+run+'-'+key
    await page.locator('[contenteditable=true]').last().fill(marker)
    await page.getByRole('button',{name:'发送消息',exact:true}).click()
    await page.getByText('ack '+marker,{exact:true}).last().waitFor()
    expected.set(marker,spec)
  }
  async function newAndSend(n,spec,key) { await openNew(n); await send(n,spec,key) }
  const sessionId = () => page.evaluate(() => JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}').sessionId)
  async function chooseManualGeneral() {
    await modelButton().click()
    await page.getByRole('menuitem',{name:/^模型 /}).click()
    await page.getByRole('menuitemradio',{name:/^General(?: |$)/}).click()
  }
  async function chooseManualCodingHigh() {
    await modelButton().click()
    await page.getByRole('menuitem',{name:/^模型 /}).click()
    await page.getByRole('menuitemradio',{name:/^Coding(?: |$)/}).click()
    await modelButton().click()
    await page.getByRole('menuitem',{name:/^推理等级(?: |$)/}).click()
    await page.getByRole('menuitemradio',{name:/^High(?: |$)/}).click()
  }
  async function assertGlobalTip(n, label) {
    await title(n).hover()
    await page.getByRole('button',{name:'设置 '+n+' 的默认模型',exact:true}).hover()
    await page.getByRole('tooltip').filter({hasText:'跟随全局：'+label}).waitFor()
    await page.locator('[contenteditable=true]').last().hover()
  }
  async function switchWorkspace(n) {
    await page.getByRole('button',{name:'选择工作区',exact:true}).click()
    await page.getByRole('menuitem',{name:n,exact:true}).click()
  }
  async function hover(n,label) {
    await title(n).hover()
    await page.locator('.dshwm-native-model').filter({hasText:label}).waitFor()
  }
  try {
    await page.goto(url)
    for(const n of ['继续','关闭']) {
      const e = page.getByRole('button',{name:n,exact:true}).first()
      if (await e.isVisible()) await e.click().catch(()=>{})
    }
    await row(P).waitFor()
    await expand(P,C)
    await expand(C,L)
    if (restart) {
      await open(P); assert.equal(await checked.isChecked(),false)
      assert.equal(await d.getByLabel('提供方',{exact:true}).inputValue(),parent[0])
      assert.equal(await group.getByLabel('子工作区提供方',{exact:true}).inputValue(),child[0])
      await cancel()
      await openNew(P)
      if (stale) {
        const saved = JSON.parse(fs.readFileSync(state,'utf8')).origins
          .flatMap(origin=>origin.localStorage).find(item=>item.name==='dsh.sessions.current')
        assert.equal(await sessionId(),JSON.parse(saved.value).sessionId,'must reuse the old parent draft')
      }
      await send(P,parent,'restart-parent')
      if (stale) await newAndSend(C,general,'restart-manual-child')
      await newAndSend(C,child,'restart-child')
    } else {
      await open(P);await mode.selectOption('custom');await choose(d,'',parent)
      await checked.uncheck();await choose(group,'子工作区',child);await save()
      await hover(P,'固定模型：Parent Medium')
      await hover(C,'由「MatrixRoot」指定：Review Low')
      await openNew(C);await assertDraft(C,child)
      await switchWorkspace(P);await assertDraft(P,parent)
      await switchWorkspace(C);await send(C,child,'picker-child')
      await newAndSend(P,parent,'sidebar-parent')
      await newAndSend(L,child,'assigned-grandchild')
      await newAndSend(O,general,'unrelated')
      await assertGlobalTip(O,'General')
      await openNew(P);await assertDraft(P,parent)
      await chooseManualCodingHigh();await send(P,local,'manual-in-fixed')
      // No page reload or settings-dialog open: a stale catalog would still say General.
      await assertGlobalTip(O,'Coding High')
      await newAndSend(O,local,'unrelated-after-manual')
      await openNew(P);await assertDraft(P,parent)
      await chooseManualGeneral();await send(P,general,'restore-native-global')
      await assertGlobalTip(O,'General')
      await open(P);await checked.check();await save()
      await hover(C,'继承自「MatrixRoot」：Parent Medium')
      await newAndSend(C,parent,'inherited')
      await newAndSend(P,parent,'sharing-parent')
      await open(C);await mode.selectOption('custom');await choose(d,'',local);await checked.uncheck();await save()
      await newAndSend(C,local,'child-custom')
      await newAndSend(L,general,'nearer-unshared')
      await open(C);await mode.selectOption('global');await save()
      await newAndSend(C,general,'child-global')
      await open(C);await mode.selectOption('inherit');await save()
      await open(P);await checked.uncheck()
      assert.equal(await group.getByLabel('子工作区模型',{exact:true}).inputValue(),child[1])
      await save()
      await newAndSend(C,child,'separate-again')
      await open(P);await choose(group,'子工作区',undefined);await save()
      await newAndSend(C,general,'cleared-child')
      await newAndSend(P,parent,'cleared-parent')
      await open(P);await mode.selectOption('global');await choose(group,'子工作区',child);await save()
      await newAndSend(P,general,'parent-global')
      await newAndSend(C,child,'assigned-from-global')
      // Change the rule while a parent draft is blank, then explicitly reopen it.
      await openNew(P);await assertDraft(P,general)
      await open(P);await mode.selectOption('custom');await save()
      await openNew(P);await assertDraft(P,parent)
      await page.reload()
      await newAndSend(P,parent,'reloaded-parent')
      if (stale) {
        await open(P);await choose(d,'',child);await save()
        await openNew(P);await assertDraft(P,child)
        await open(P);await choose(d,'',parent);await save()
        await page.context().storageState({path:state})
        await openNew(C);await assertDraft(C,child)
        await chooseManualGeneral();await assertDraft(C,general)
        // Preserve the parent navigation snapshot, but stop and restart the
        // same Host with both the plugin-selected and hand-picked drafts.
      }
    }
    const requests = fs.readFileSync(process.env.DSH_TEST_MOCK_LOG,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))
    for (const [marker,[provider,model,,effort]] of expected) {
      const matching = requests.filter(x=>x.marker===marker && !x.title)
      assert.equal(matching.length,1,marker)
      assert.deepEqual([matching[0].provider,matching[0].model,matching[0].effort],[provider,model,effort],marker)
    }
    console.log((better?'Better Workspace':'Native')+': '+expected.size+' composer / first-request cases passed')
  } finally { await browser.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
