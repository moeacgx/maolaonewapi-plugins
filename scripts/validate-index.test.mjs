import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { validateIndex } from './validate-index.mjs'

test('公开索引保护源码 hash 与历史版本不可变', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-index-'))
  try {
    const source = '// 已审查源码示例\n'
    const relative = 'published/demo/1.0.0/plugin.js'
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, source)
    const index = { indexVersion: 1, name: 'Test', plugins: [{ key: 'demo', name: 'Demo', latest: '1.0.0', versions: [{ version: '1.0.0', path: relative, sha256: createHash('sha256').update(source).digest('hex'), kind: 'task', minApiVersion: 1 }] }] }
    await writeFile(path.join(root, 'index.json'), JSON.stringify(index))
    assert.equal(await validateIndex(root), 1)
    await writeFile(file, '// replaced')
    await assert.rejects(validateIndex(root), /hash 不一致/)
    await writeFile(file, source)
    await writeFile(path.join(root, 'base.json'), JSON.stringify(index))
    await writeFile(path.join(root, 'index.json'), JSON.stringify({ indexVersion: 1, plugins: [] }))
    await assert.rejects(validateIndex(root, path.join(root, 'base.json')), /不可修改或删除/)
    index.plugins[0].versions[0].path = '../secret.js'
    await writeFile(path.join(root, 'index.json'), JSON.stringify(index))
    await assert.rejects(validateIndex(root), /路径/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
