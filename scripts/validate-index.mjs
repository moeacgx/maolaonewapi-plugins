import { createHash } from 'node:crypto'
import { readFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const keyPattern = /^[a-z0-9][a-z0-9_-]{0,29}$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export async function validateIndex(root, baseFile) {
  const bytes = await readFile(path.join(root, 'index.json'))
  if (bytes.length > 2 * 1024 * 1024) throw new Error('索引超过 2 MiB')
  const index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (index.indexVersion !== 1 || !Array.isArray(index.plugins)) throw new Error('索引必须采用 indexVersion 1')
  const keys = new Set()
  const identities = new Map()
  for (const plugin of index.plugins) {
    if (!keyPattern.test(plugin.key) || keys.has(plugin.key) || typeof plugin.name !== 'string' || !plugin.name.trim()) throw new Error('插件标识无效或重复')
    keys.add(plugin.key)
    if (!Array.isArray(plugin.versions) || !plugin.versions.length) throw new Error('插件没有版本')
    for (const version of plugin.versions) {
      const identity = `${plugin.key}@${version.version}`
      if (typeof version.version !== 'string' || version.version.length > 64 || !versionPattern.test(version.version) || identities.has(identity)) throw new Error('版本无效或重复')
      const expected = `published/${plugin.key}/${version.version}/plugin.js`
      if (version.path !== expected || version.kind !== 'task' || version.minApiVersion !== 1 || !/^[a-f0-9]{64}$/.test(version.sha256)) throw new Error('路径、类型、API 版本或 hash 无效')
      // 拒绝文件和祖先目录符号链接，避免发布目录外的数据。
      let resolved = root
      for (const segment of expected.split('/')) {
        resolved = path.join(resolved, segment)
        if ((await lstat(resolved)).isSymbolicLink()) throw new Error('发布路径不能使用符号链接')
      }
      const info = await lstat(resolved)
      if (!info.isFile() || info.size > 1024 * 1024) throw new Error('源码必须为不超过 1 MiB 的普通文件')
      const source = await readFile(resolved)
      new TextDecoder('utf-8', { fatal: true }).decode(source)
      if (createHash('sha256').update(source).digest('hex') !== version.sha256) throw new Error(`源码 hash 不一致：${identity}`)
      identities.set(identity, version)
    }
    if (!identities.has(`${plugin.key}@${plugin.latest}`)) throw new Error('latest 必须指向已有版本')
  }
  if (baseFile) {
    const base = JSON.parse(await readFile(baseFile, 'utf8'))
    for (const plugin of base.plugins) for (const old of plugin.versions) {
      const identity = `${plugin.key}@${old.version}`
      const current = identities.get(identity)
      if (!current || current.path !== old.path || current.sha256 !== old.sha256) throw new Error(`已发布版本不可修改或删除：${identity}`)
    }
  }
  return identities.size
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--base')) throw new Error('用法：node scripts/validate-index.mjs [--base old-index.json]')
  const count = await validateIndex(process.cwd(), args[1])
  console.log(`插件源校验通过：${count} 个版本`)
}
