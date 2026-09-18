import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [cocoRoot, outputRoot] = process.argv.slice(2)
if (!cocoRoot || !outputRoot) throw new Error('usage: prepare-packages.ts COCO_ROOT OUTPUT_ROOT')

const packages = [
	{ source: 'core', output: 'core' },
	{ source: 'indexeddb', output: 'indexeddb' },
] as const

for (const descriptor of packages) {
	const sourceRoot = path.join(cocoRoot, 'packages', descriptor.source)
	const targetRoot = path.join(outputRoot, 'packages', descriptor.output)
	await mkdir(targetRoot, { recursive: true })
	await cp(path.join(sourceRoot, 'dist'), path.join(targetRoot, 'dist'), { recursive: true })
	await cp(path.join(sourceRoot, 'README.md'), path.join(targetRoot, 'README.md'))

	const packageJson = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8')) as {
		exports?: Record<string, unknown>
		[key: string]: unknown
	}
	packageJson.exports = {
		...(packageJson.exports ?? {}),
		'./runtime-probe': {
			types: './runtime-probe.d.ts',
			import: './runtime-probe.js',
		},
	}
	await writeFile(path.join(targetRoot, 'package.json'), `${JSON.stringify(packageJson, null, '\t')}\n`)
	await writeFile(path.join(targetRoot, 'runtime-probe.js'), "export { Amount } from '@cashu/cashu-ts'\n")
	await writeFile(path.join(targetRoot, 'runtime-probe.d.ts'), 'export declare const Amount: any\n')
}

await cp(path.join(process.cwd(), 'scripts/coco-runtime/README.md'), path.join(outputRoot, 'README.md'))
