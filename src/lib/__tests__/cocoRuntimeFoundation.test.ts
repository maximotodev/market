import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { inspectCocoRuntime } from '../coco/auctionDemo/runtimeProbe'

const projectRoot = process.cwd()
const runtimeRoot = path.join(projectRoot, 'vendor/coco-runtime-190b25b0')

const treeDigest = async (relativeRoot: string): Promise<string> => {
	const root = path.join(runtimeRoot, relativeRoot)
	const files: string[] = []
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name)
			if (entry.isDirectory()) await visit(absolute)
			else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll('\\', '/'))
		}
	}
	await visit(root)
	const hash = createHash('sha256')
	for (const file of files.sort())
		hash
			.update(file)
			.update('\0')
			.update(await readFile(path.join(root, file)))
			.update('\0')
	return hash.digest('hex')
}

describe('frozen Coco runtime foundation', () => {
	test('shares one cashu-ts constructor across core and IndexedDB', () => {
		const runtime = inspectCocoRuntime()
		expect(runtime.commit).toBe('190b25b0c16eb6ebbb42e1d67a0d28399c641ae1')
		expect(runtime.cashuTsVersion).toBe('5.0.0-rc.4')
		expect(runtime.sameAmountConstructor).toBe(true)
		expect(runtime.coreAcceptsIndexedDbAmount).toBe(true)
		expect(runtime.indexedDbAcceptsCoreAmount).toBe(true)
	})

	test('links both packages to one physical cashu-ts directory', async () => {
		const shared = path.join(projectRoot, 'node_modules/@plebeian-market/coco-cashu-ts')
		const core = path.join(projectRoot, 'node_modules/@cashu/coco-core/node_modules/@cashu/cashu-ts')
		const indexedDb = path.join(projectRoot, 'node_modules/@cashu/coco-indexeddb/node_modules/@cashu/cashu-ts')
		expect((await lstat(core)).isSymbolicLink()).toBe(true)
		expect((await lstat(indexedDb)).isSymbolicLink()).toBe(true)
		expect(await realpath(core)).toBe(await realpath(shared))
		expect(await realpath(indexedDb)).toBe(await realpath(shared))
	})

	test('matches every generated artifact hash', async () => {
		const manifest = JSON.parse(await readFile(path.join(projectRoot, 'scripts/coco-runtime/manifest.json'), 'utf8'))
		expect(await treeDigest('packages/core')).toBe(manifest.coreArtifactSha256)
		expect(await treeDigest('packages/indexeddb')).toBe(manifest.indexedDbArtifactSha256)
	})
})
