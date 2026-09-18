import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const [manifestPath, packageRoot] = process.argv.slice(2)
if (!manifestPath || !packageRoot) throw new Error('usage: verify-manifest.ts MANIFEST PACKAGE_ROOT')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>
const treeDigest = async (relativeRoot: string): Promise<string> => {
	const root = path.join(packageRoot, relativeRoot)
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

const actual = {
	coreArtifactSha256: await treeDigest('packages/core'),
	indexedDbArtifactSha256: await treeDigest('packages/indexeddb'),
}

console.log(JSON.stringify(actual))

for (const [key, value] of Object.entries(actual)) {
	if (manifest[key] !== value) throw new Error(`${key} mismatch: expected ${manifest[key]}, got ${value}`)
}
