import { readFileSync, writeFileSync } from 'node:fs'
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8')
const tag = /    \/\/ BEGIN SHARED INHERITANCE\n[\s\S]*?    \/\/ END SHARED INHERITANCE/
const shared = read('inheritance.js').replace('export function', 'function').trimEnd().split('\n').map(line => line && '    ' + line).join('\n')
const client = read('client.js')
if (!tag.test(client)) throw Error('Missing generated block')
const next = client.replace(tag, () => '    // BEGIN SHARED INHERITANCE\n' + shared + '\n    // END SHARED INHERITANCE')
if (process.argv.includes('--check')) {
  if (next !== client) throw Error('Run npm run sync:inheritance')
} else writeFileSync(new URL('../client.js', import.meta.url), next)
