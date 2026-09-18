import { lstat, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const nodeModules = path.join(projectRoot, 'node_modules')
const sharedRuntime = path.join(nodeModules, '@plebeian-market/coco-cashu-ts')
const sharedManifest = JSON.parse(await readFile(path.join(sharedRuntime, 'package.json'), 'utf8')) as { version?: string }

if (sharedManifest.version !== '5.0.0-rc.4') {
	throw new Error(`Expected shared Coco cashu-ts 5.0.0-rc.4, got ${sharedManifest.version ?? 'missing'}`)
}

for (const packageName of ['coco-core', 'coco-indexeddb']) {
	const parent = path.join(nodeModules, '@cashu', packageName, 'node_modules', '@cashu')
	const target = path.join(parent, 'cashu-ts')
	await rm(target, { recursive: true, force: true })
	await mkdir(parent, { recursive: true })
	await symlink(path.relative(parent, sharedRuntime), target, 'dir')
	if (!(await lstat(target)).isSymbolicLink()) throw new Error(`${packageName} cashu-ts runtime is not a symlink`)
	if ((await realpath(target)) !== (await realpath(sharedRuntime)))
		throw new Error(`${packageName} cashu-ts runtime does not resolve to the shared instance`)
}

console.log('Linked Coco core and IndexedDB to one cashu-ts@5.0.0-rc.4 runtime')
