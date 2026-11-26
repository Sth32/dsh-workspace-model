window.__ModuleLoader__.load({
  id: 'dsh-workspace-model',
  factory: () => {
    const exports = {}
    const entry = 'workspace-model-defaults'
    // BEGIN SHARED INHERITANCE
    // Shared by the server and the generated block in client.js. Use the
    // host-spelled registered paths, matching the native disk tree semantics.
    function effectiveRule(id, items, rules, inheritEnabled) {
      const byId = new Map(rules.map(rule => [rule.workspaceId, rule]))
      const local = byId.get(id)
      if (local && !local.inherit) return { rule: local }
      if (!inheritEnabled) return {}
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
        if (!candidate || candidate.inherit || root == null || root.length <= length
          || child === root || !child.startsWith(root + '/')) continue
        source = workspace
        rule = candidate
        length = root.length
      }
      // An explicit “follow global” on an ancestor also ends the search.
      return source ? { rule, source } : {}
    }
    // END SHARED INHERITANCE
    exports.inject = ['configForms', 'remote', 'remote.session', 'workspaces', 'contextMenus']
    exports.apply = ctx => {
      const form = ctx.get('configForms').get(entry)
      const workspaces = ctx.get('workspaces').list
      const remote = ctx.get('remote')
      const controls = new Map()
      let catalog, catalogError, disposed = false, refreshing = false, dialog, tip
      const rules = () => form.getSnapshot().value?.rules ?? []
      const inheritEnabled = () => form.getSnapshot().value?.inheritEnabled === true
      const find = id => rules().find(x => x.workspaceId === id)
      const name = ws => ws.title || ws.name || ws.path?.split(/[/\\]/).filter(Boolean).at(-1) || ws.workspaceId
      const element = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), {textContent: text}, attrs)
      const opt = (value, label) => element('option', label, {value})
      const global = () => catalog?.default
      const modelText = rule => {
        if (!rule?.provider || !rule?.model) return '未配置'
        const group = catalog?.groups?.find(item => item.id === rule.provider)
        const model = group?.models.find(item => item.id === rule.model)
        const effort = model?.reasoning?.efforts?.find(item => item.id === rule.reasoningEffort)
        return [model?.name || rule.model, effort?.name || rule.reasoningEffort || ''].filter(Boolean).join(' ')
      }
      const line = (rule, type) => type + '：' + modelText(rule)
      const effective = (ws, choices = rules()) =>
        effectiveRule(ws.workspaceId, workspaces.getSnapshot().items ?? [], choices, inheritEnabled())
      const inheritedLine = ({rule,source}) => source && rule?.enabled && rule.provider && rule.model
        ? '继承自「' + name(source) + '」：' + modelText(rule) : ''
      const cardLine = ws => {
        const {rule,source} = effective(ws)
        return source ? inheritedLine({rule,source}) : rule?.enabled && rule.provider && rule.model ? line(rule,'固定模型') : ''
      }
      // One low-detail outline at 14 px, matching the native new-session glyph.
      function cloudIcon(pinned) {
        const ns = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(ns, 'svg')
        for (const [key, value] of Object.entries({viewBox:'0 0 16 16', width:'14', height:'14', fill:'none',
          stroke:'currentColor', 'stroke-width':'1.25', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true'})) svg.setAttribute(key, value)
        const shapes = pinned ? [
          // Leave room on the upper-right shoulder for the slanted pin.
          ['M7.85 5.48a3.58 3.58 0 0 0-3.77 2.37 2.8 2.8 0 0 0 .05 5.6h7.13a2.72 2.72 0 0 0 1.06-5.22'],
          ['M-2.15-3.2h4.3M-1.2-3.2v2.35L-2.2.35v.55h4.4V.35L1.2-.85V-3.2M0 .9v3.3',
            'translate(10.9 5.25) rotate(42)'],
        ] : [['M4.45 12.22h7.21a2.76 2.76 0 0 0 .11-5.5 3.86 3.86 0 0 0-7.61.12 2.7 2.7 0 0 0 .29 5.38z']]
        for (const [shape, transform] of shapes) {
          const path = document.createElementNS(ns, 'path')
          path.setAttribute('d', shape)
          if (transform) path.setAttribute('transform', transform)
          svg.append(path)
        }
        return svg
      }
      function removeTip() { tip?.remove(); tip = undefined }
      function showTip(button, ws) {
        if (dialog?.open) return
        removeTip()
        const r = button.getBoundingClientRect()
        // Anchor past the row so the tooltip never hides its other actions.
        const rowRight = button.closest('[role="treeitem"]')?.getBoundingClientRect().right ?? r.right
        tip = element('div', '', {id:'dshwm-tip', className:'dshwm-tip'})
        tip.setAttribute('role', 'tooltip')
        tip.textContent = cardLine(ws) || line(global(), '跟随全局')
        document.body.append(tip)
        const w = tip.getBoundingClientRect().width
        tip.style.left = Math.max(6, Math.min(rowRight + 8, innerWidth - w - 8)) + 'px'
        tip.style.top = Math.max(8, Math.min(r.top + (r.height - tip.offsetHeight) / 2, innerHeight - tip.offsetHeight - 8)) + 'px'
      }
      async function refreshCatalog() {
        if (refreshing) return
        refreshing = true
        try {
          const r = await remote.session.modelCatalog()
          if (!r?.ok || !r.value?.groups) throw new Error('模型目录暂不可用')
          catalog = r.value
          catalogError = ''
        } catch { catalogError = '模型目录暂不可用。关闭后重试，或先在原生「模型」设置中检查提供方。' }
        finally { refreshing = false; if (!disposed) sync() }
      }
      function label(title, control) {
        const out = element('label', '', {className:'dshwm-field'})
        control.setAttribute('aria-label', title)
        out.append(element('span', title), control)
        return out
      }
      async function open(ws) {
        if (disposed || dialog?.open) return
        removeTip()
        const stored = find(ws.workspaceId)
        const draft = {workspaceId:ws.workspaceId, enabled:stored?.enabled ?? false, inherit: !stored || stored.inherit === true,
          provider:stored?.provider ?? '', model:stored?.model ?? '', reasoningEffort:stored?.reasoningEffort ?? ''}
        const d = dialog = element('dialog', '', {className:'dshwm-dialog'})
        d.setAttribute('aria-labelledby','dshwm-title')
        d.append(element('h2', '工作区默认模型', {id:'dshwm-title'}),
          element('p', name(ws), {className:'dshwm-workspace'}),element('small',ws.path || ''),
          element('p','只影响在此工作区新建的会话，不改已有对话和全局默认。',{className:'dshwm-desc'}))
        const mode = element('select','')
        mode.append(opt('inherit','继承父工作区'),opt('global','跟随全局'),opt('custom','使用专属模型'))
        mode.value = draft.inherit ? 'inherit' : draft.enabled ? 'custom' : 'global'
        const inheritance = element('input','',{type:'checkbox',className:'dshwm-inherit-toggle'})
        const switchRow = element('label','',{className:'dshwm-inherit-setting'})
        switchRow.append(inheritance, element('span','在所有工作区启用父级继承（即时保存）'))
        const provider = element('select',''), model = element('select',''), effort = element('select','')
        const fields = element('div','')
        fields.append(label('提供方',provider),label('模型',model),label('思考等级',effort))
        const details = element('p','',{className:'dshwm-desc',ariaLive:'polite'})
        const notice = element('p','',{className:'dshwm-notice',ariaLive:'polite'})
        const actions = element('div','',{className:'dshwm-actions'})
        const cancel = element('button','取消',{type:'button'})
        const save = element('button','保存',{type:'button',className:'dshwm-primary'})
        cancel.onclick = () => d.close()
        actions.append(cancel,save)
        const preferenceNotice = element('p','',{className:'dshwm-notice',ariaLive:'polite'})
        d.append(switchRow,preferenceNotice,label('默认规则',mode),details,fields,notice,actions)
        function fill(input, values, selected, caption) {
          input.replaceChildren(opt('',caption), ...values.map(x=>opt(x.id,x.name || x.id)))
          if (selected && !values.some(x=>x.id===selected)) input.append(opt(selected, selected+'（不可用）'))
          input.value = selected || ''
        }
        let saving = false, pendingInheritance
        function draw() {
          const groups = catalog?.groups ?? []
          const g = groups.find(g=>g.id===draft.provider), m = g?.models.find(m=>m.id===draft.model)
          fill(provider,groups,draft.provider,'请选择提供方')
          fill(model,g?.models ?? [],draft.model,'请选择模型')
          fill(effort,m?.reasoning?.efforts ?? [],draft.reasoningEffort,'模型默认')
          fields.hidden = !draft.enabled
          provider.disabled = !groups.length
          model.disabled = !g
          effort.disabled = !m?.reasoning?.efforts?.length
          const inherited = draft.inherit ? effective(ws, [...rules().filter(x=>x.workspaceId!==ws.workspaceId),draft]) : {}
          const inheritedDetails = inheritedLine(inherited) ||
            (inherited.source ? '继承自「' + name(inherited.source) + '」：跟随全局。' :
              !inheritEnabled() ? '父级继承已关闭。' : '没有可继承的父级配置。')
          details.textContent = draft.enabled ? '手动选择的模型仍可覆盖默认值。' :
            (draft.inherit ? inheritedDetails + ' ' : '') + line(global(),'全局默认') + (draft.model ? '。上次专属配置已保留。' : '')
          if (draft.inherit && inherited.rule?.enabled) details.textContent = inheritedDetails + (draft.model ? '。上次专属配置已保留。' : '')
          const blocked = draft.enabled && (!m || (draft.reasoningEffort && !m.reasoning?.efforts?.some(e=>e.id===draft.reasoningEffort)))
          const writable = form.getSnapshot().writable
          const switching = pendingInheritance !== undefined
          inheritance.checked = pendingInheritance ?? inheritEnabled()
          inheritance.disabled = !writable || switching || saving
          save.disabled = saving || switching || !writable || !!blocked
          notice.textContent = !writable ? '当前配置不可写，请确认你已连接本机 DSH。' : (draft.enabled ? catalogError || '' : '')
        }
        mode.onchange = ()=>{draft.enabled=mode.value==='custom';draft.inherit=mode.value==='inherit';draw()}
        inheritance.onchange = async ()=>{
          const value = inheritance.checked
          pendingInheritance=value; preferenceNotice.textContent=''; draw()
          try {
            if (!await form.set('inheritEnabled',value)) throw new Error()
          } catch {
            preferenceNotice.textContent='继承开关未保存，请重试。'
          } finally {pendingInheritance=undefined;draw()}
        }
        provider.onchange = ()=>{draft.provider=provider.value;draft.model='';draft.reasoningEffort='';draw()}
        model.onchange = ()=>{draft.model=model.value;draft.reasoningEffort='';draw()}
        effort.onchange = ()=>{draft.reasoningEffort=effort.value;draw()}
        save.onclick = async ()=>{
          if (saving) return
          saving = true; draw()
          const changes = rules().filter(x=>x.workspaceId!==ws.workspaceId)
          changes.push({...draft})
          try {
            if (!await form.set('rules',changes)) throw new Error()
            d.close()
          } catch {
            saving = false; draw()
            notice.textContent = '未保存。请刷新后重试；没有更改已保存的规则。'
          }
        }
        d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=undefined},{once:true})
        document.body.append(d);d.showModal();draw()
        await refreshCatalog()
        if (d.isConnected) draw()
      }
      const style = element('style', `
         .dshwm-pin{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin:-4px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,GrayText)}
         .dshwm-pin:hover{background:var(--dsw-alias-interactive-bg-hover)}
         .dshwm-pin:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,Highlight);outline-offset:-2px}
         .dshwm-pin[data-enabled=true]{color:var(--dsw-alias-state-business-primary,LinkText)}
         .bw-row-actions>.dshwm-pin{width:16px;height:16px;margin:0}
         .dshwm-tip,.dshwm-dialog{background:var(--dsw-alias-bg-layer-3,Canvas);color:var(--dsw-alias-label-primary,CanvasText);border:1px solid var(--dsw-alias-border-l2,GrayText);border-radius:var(--dsw-radius-lg,12px)}
         .dshwm-native-model{font-size:13px;line-height:20px;font-weight:400;color:var(--dsw-alias-hovercard-label-primary,var(--dsw-alias-label-primary));overflow-wrap:anywhere}
         .dshwm-tip{position:fixed;z-index:1200;padding:5px 9px;max-width:min(400px,90vw);pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;font-weight:400;box-shadow:0 3px 14px #0002}
         .dshwm-dialog{width:min(440px,calc(100vw - 36px));padding:20px;box-sizing:border-box;font:inherit;font-size:13px;line-height:20px;box-shadow:0 12px 40px #0003}
         body[data-ds-dark-theme] .dshwm-dialog{color-scheme:dark}
         body:not([data-ds-dark-theme]) .dshwm-dialog{color-scheme:light}
         .dshwm-dialog::backdrop{background:var(--dsw-alias-bg-mask-1,#0004)}
         .dshwm-dialog h2{margin:0 0 12px;font-size:16px;line-height:24px;font-weight:600}
         .dshwm-workspace{font-weight:600;margin:0 0 2px}
         .dshwm-dialog small,.dshwm-desc{color:var(--dsw-alias-label-secondary,GrayText)}
         .dshwm-dialog small{overflow-wrap:anywhere}
         .dshwm-field{display:grid;grid-template-columns:78px 1fr;align-items:center;gap:12px;margin:8px 0}
         .dshwm-inherit-setting{display:flex;align-items:center;gap:8px;margin:12px 0;font-size:12px;line-height:18px}
         .dshwm-inherit-toggle{margin:0;accent-color:var(--dsw-alias-state-business-primary,Highlight)}
         .dshwm-field select{width:100%;min-width:0;height:32px;box-sizing:border-box;background:var(--dsw-alias-bg-module-platform,Field);color:var(--dsw-alias-label-primary,FieldText);border:1px solid var(--dsw-alias-border-l2,GrayText);border-radius:var(--dsw-radius-sm,6px);padding:4px 8px;font:inherit}
         .dshwm-field select:focus-visible,.dshwm-actions button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,Highlight);outline-offset:1px}
         .dshwm-desc{font-size:12px;line-height:18px;margin:8px 0}
         .dshwm-notice{font-size:12px;color:var(--dsw-alias-label-secondary,GrayText)}
         .dshwm-notice:empty{display:none}
         .dshwm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
         .dshwm-actions button{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,GrayText);border-radius:var(--dsw-radius-sm,6px);padding:5px 13px;cursor:pointer}
         .dshwm-actions button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
         .dshwm-actions .dshwm-primary,.dshwm-actions .dshwm-primary:hover:not(:disabled){background:var(--dsw-alias-state-business-primary,Highlight);color:white;border-color:transparent}
         .dshwm-actions .dshwm-primary:hover:not(:disabled){filter:brightness(.94)}
         .dshwm-actions button:disabled{opacity:.42;cursor:not-allowed}
      `)
      // The native card is portaled. Its CSS positioning anchor uniquely links
      // it to the exact row, even if multiple workspaces have the same title.
      // Unknown host markup is left untouched, alongside the icon's own hint.
      function syncNativeCards(anchors, paths) {
        for (const card of document.querySelectorAll('[style*="--dsh-hover-preview-fade"]')) {
          const anchor = card.style.getPropertyValue('position-anchor').trim()
          // The older renderer uses JS positioning. Its copy action carries the
          // complete workspace path; do not infer identity from a title or ~ path.
          const copyLabel = card.getAttribute('aria-label') ?? ''
          const candidates = !anchor ? [...paths].filter(([path]) =>
            copyLabel.endsWith(': ' + path) || copyLabel.endsWith('：' + path) || copyLabel.endsWith('： ' + path)) : []
          const ws = anchor ? anchors.get(anchor) : candidates.length === 1 ? candidates[0][1] : undefined
          const content = card.querySelector(':scope > [class*="_hoverContent"]')
          const label = content?.querySelector(':scope > .dshwm-native-model')
          const text = ws && !tip ? cardLine(ws) : ''
          if (!text ||
            !content?.querySelector(':scope > [class*="_hoverPath"]') ||
            !content.querySelector(':scope > [class*="_hoverTime"]')) {
            label?.remove()
            continue
          }
          if (!label) content.append(element('div', text, {className:'dshwm-native-model'}))
          else if (label.textContent !== text) label.textContent = text
        }
      }
      // Better Workspace renders its own row/card but passes the registered
      // workspace ID to native new-session creation. Adapt only its UI.
      function syncBetterCards(anchors, paths) {
        for (const content of document.querySelectorAll('[style*="--dsh-hover-preview-fade"] > .bw-hover-card')) {
          const anchor = content.parentElement.style.getPropertyValue('position-anchor').trim()
          const path = content.querySelector(':scope > .bw-hover-path')?.textContent
          const ws = anchor ? anchors.get(anchor) : path ? paths.get(path) : undefined
          const label = content.querySelector(':scope > .dshwm-native-model')
          const text = ws && !tip ? cardLine(ws) : ''
          if (!content.querySelector(':scope > .bw-hover-title') || !text) {
            label?.remove()
            continue
          }
          if (!label) content.append(element('div', text, {className:'dshwm-native-model'}))
          else if (label.textContent !== text) label.textContent = text
        }
      }
      const sync = () => {
        if (disposed) return
        const anchors = new Map(), paths = new Map()
        const betterAnchors = new Map(), betterPaths = new Map()
        const list = new Map((workspaces.getSnapshot().items ?? []).map(ws=>[String(ws.workspaceId),ws]))
        for (const [row, data] of controls) {
          if (!row.isConnected || !data.button.isConnected) {data.button.remove();controls.delete(row)}
        }
        for (const row of document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:"], .bw-container-row[role="treeitem"][data-row-key^="ws-"]')) {
          const key = row.getAttribute('data-row-key')
          const better = key.startsWith('ws-')
          const ws = list.get(key.slice(better ? 'ws-'.length : 'workspace:'.length))
          if (!ws) continue
          const rowAnchors = better ? betterAnchors : anchors
          const rowPaths = better ? betterPaths : paths
          const anchor = row.parentElement?.style.getPropertyValue('anchor-name').trim()
          if (anchor?.startsWith('--dsh-hover-card-')) rowAnchors.set(anchor, ws)
          if (ws.path) rowPaths.set(ws.path, rowPaths.has(ws.path) ? null : ws)
          const action = better ? row.querySelector(':scope > .bw-row-actions') : row.lastElementChild
          if (!(action instanceof HTMLElement) || !action.querySelector('button')) continue
          let item = controls.get(row)
          if (!item || item.wsId !== ws.workspaceId || item.button.parentElement !== action) {
            item?.button.remove()
            const button = element('button','',{type:'button',className:'dshwm-pin'})
            button.setAttribute('aria-describedby','dshwm-tip')
            button.onclick = e => {e.stopPropagation();void open(ws)}
            button.onmouseenter = ()=>showTip(button,ws)
            button.onmouseleave = removeTip
            button.onfocus = ()=>showTip(button,ws)
            button.onblur = removeTip
            action.prepend(button)
            item={button,wsId:ws.workspaceId};controls.set(row,item)
          }
          item.button.setAttribute('aria-label','设置 '+name(ws)+' 的默认模型')
          const local = find(ws.workspaceId)
          const enabled = !!local?.enabled && !local?.inherit
          if (item.button.dataset.enabled !== String(enabled)) {
            item.button.dataset.enabled = String(enabled)
            item.button.replaceChildren(cloudIcon(enabled))
          }
        }
        syncNativeCards(anchors, paths)
        syncBetterCards(betterAnchors, betterPaths)
      }
      ctx.effect(()=>{
        document.head.append(style)
        const unsub = workspaces.subscribe(sync)
        const unsubForm = form.subscribe(sync)
        const unregister = ctx.get('contextMenus').register({
          id: 'workspace.default-model.settings', target:'workspace', order:150,
          resolve: target => {
            const ws = (workspaces.getSnapshot().items ?? []).find(w=>w.workspaceId===target.workspaceId)
            return ws ? [{id:'default-model-settings',label:'默认模型设置',run:()=>void open(ws)}] : []
          },
        })
        const observer = new MutationObserver(sync)
        observer.observe(document.body,{childList:true,subtree:true})
        sync(); void refreshCatalog()
        return ()=>{disposed=true;observer.disconnect();unsub();unsubForm();unregister();removeTip();dialog?.close();for(const label of document.querySelectorAll('.dshwm-native-model'))label.remove();for(const {button} of controls.values())button.remove();controls.clear();style.remove()}
      })
    }
    return exports
  },
})
