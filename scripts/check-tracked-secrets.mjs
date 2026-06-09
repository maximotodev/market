#!/usr/bin/env bun

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

const STAGED_MODE = process.argv.includes('--staged')
const MAX_TEXT_FILE_BYTES = 1024 * 1024

const SKIP_PATH_PREFIXES = [
	'node_modules/',
	'dist/',
	'out/',
	'build/',
	'coverage/',
	'playwright-report/',
	'test-results/',
	'contextvm/data/',
]

const SKIP_EXACT_PATHS = new Set(['bun.lock', 'package-lock.json', 'src/routeTree.gen.ts'])

const SKIP_EXTENSIONS = new Set(['.ico', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ttf', '.woff', '.woff2', '.map', '.lock'])

const SECRET_PATTERNS = [
	{
		name: 'private-key-env-value',
		regex: /\b(?:APP_PRIVATE_KEY|CVM_SERVER_KEY|NOSTR_PRIVATE_KEY|PRIVATE_KEY|SECRET_KEY)\b\s*[:=]\s*['"]?[0-9a-fA-F]{64}\b/,
	},
	{
		name: 'nsec-private-key',
		regex: /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b/i,
	},
	{
		name: 'nwc-connection-string',
		regex: /\bnostr\+walletconnect:\/\/[^\s"'`<>]+/i,
	},
	{
		name: 'cashu-token-or-proof',
		regex: /\bcashu[A-Za-z0-9_-]{40,}\b/,
	},
	{
		name: 'mnemonic-or-seed-phrase',
		regex: /\b(?:mnemonic|seed phrase|recovery phrase)\b\s*[:=]\s*['"]?(?:[a-z]+[\s,]+){11,23}[a-z]+\b/i,
	},
	{
		name: 'bearer-token',
		regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/,
	},
	{
		name: 'payment-preimage',
		regex: /\b(?:preimage|payment_preimage|paymentPreimage|preimage_hex|preimageHex)\b\s*[:=]\s*['"]?[0-9a-fA-F]{64}\b/,
	},
	{
		name: 'api-key-or-credential',
		regex:
			/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|password|credential|credentials)\b\s*[:=]\s*['"]?(?!<|\$\{|process\.env|Bun\.env|undefined|null|true|false)[A-Za-z0-9._~+/=-]{24,}\b/i,
	},
	{
		name: 'private-key-block',
		regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	},
]

const ALLOWED_FINDINGS = [
	{
		path: '.github/workflows/ci-unit.yml',
		pattern: 'private-key-env-value',
		maxCount: 1,
		reason: 'intentional local CI test fixture',
	},
	{
		path: '.github/workflows/e2e.yml',
		pattern: 'private-key-env-value',
		maxCount: 2,
		reason: 'intentional local E2E test fixture',
	},
	{
		path: 'deploy-simple/env/.env.development.example',
		pattern: 'private-key-env-value',
		maxCount: 2,
		reason: 'existing development example fixture',
	},
	{
		path: 'e2e/ARCHITECTURE.md',
		pattern: 'private-key-env-value',
		maxCount: 1,
		reason: 'existing E2E documentation fixture',
	},
	{
		path: 'e2e/tests/payments.spec.ts',
		pattern: 'nwc-connection-string',
		maxCount: 1,
		reason: 'intentional payment test fixture',
	},
	{
		path: 'scripts/start-test-env.sh',
		pattern: 'private-key-env-value',
		maxCount: 1,
		reason: 'intentional local test environment fixture',
	},
	{
		path: 'src/lib/fixtures.ts',
		pattern: 'nsec-private-key',
		maxCount: 1,
		reason: 'existing application fixture',
	},
	{
		path: 'src/routes/_dashboard-layout/dashboard/account/making-payments.tsx',
		pattern: 'nwc-connection-string',
		maxCount: 2,
		reason: 'existing user-facing NWC example text',
	},
]

const allowedFindingUsage = new Map()

const PLACEHOLDER_MARKERS = [
	'<',
	'${{ secrets.',
	'process.env',
	'Bun.env',
	'REPLACE',
	'CHANGE_ME',
	'YOUR_',
	'your_',
	'placeholder',
	'example',
	'dummy',
]

function runGit(args) {
	const result = spawnSync('git', args, {
		encoding: 'buffer',
		stdio: ['ignore', 'pipe', 'pipe'],
	})

	if (result.status !== 0) {
		const stderr = result.stderr.toString('utf8').trim()
		throw new Error(stderr || `git ${args.join(' ')} failed`)
	}

	return result.stdout
}

function getCandidatePaths() {
	const args = STAGED_MODE ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'] : ['ls-files', '-z']
	return runGit(args).toString('utf8').split('\0').filter(Boolean)
}

function hasSkippedExtension(path) {
	const lower = path.toLowerCase()
	for (const ext of SKIP_EXTENSIONS) {
		if (lower.endsWith(ext)) return true
	}
	return false
}

function shouldSkipPath(path) {
	if (SKIP_EXACT_PATHS.has(path)) return true
	if (SKIP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
	if (hasSkippedExtension(path)) return true
	if (!existsSync(path)) return true

	const stat = statSync(path)
	if (!stat.isFile()) return true
	if (stat.size > MAX_TEXT_FILE_BYTES) return true

	return false
}

function isBinary(buffer) {
	return buffer.includes(0)
}

function isPlaceholderLine(line) {
	return PLACEHOLDER_MARKERS.some((marker) => line.includes(marker))
}

function isAllowedFinding(path, pattern) {
	const allowed = ALLOWED_FINDINGS.find((entry) => entry.path === path && entry.pattern === pattern)
	if (!allowed) return false

	const key = `${path}\0${pattern}`
	const used = allowedFindingUsage.get(key) ?? 0
	if (used >= allowed.maxCount) return false

	allowedFindingUsage.set(key, used + 1)
	return true
}

function scanPath(path) {
	if (shouldSkipPath(path)) return []

	const buffer = readFileSync(path)
	if (isBinary(buffer)) return []

	const text = buffer.toString('utf8')
	const findings = []

	text.split(/\r?\n/).forEach((line) => {
		if (isPlaceholderLine(line)) return

		for (const pattern of SECRET_PATTERNS) {
			pattern.regex.lastIndex = 0
			if (!pattern.regex.test(line)) continue
			if (isAllowedFinding(path, pattern.name)) continue
			findings.push({ path, pattern: pattern.name })
		}
	})

	return findings
}

const findings = []

for (const path of getCandidatePaths()) {
	findings.push(...scanPath(path))
}

if (findings.length > 0) {
	console.error('Potential tracked secrets found. Values are intentionally redacted.')
	for (const finding of findings) {
		console.error(`- ${finding.path}: ${finding.pattern}`)
	}
	process.exit(1)
}

const mode = STAGED_MODE ? 'staged files' : 'tracked files'
console.log(`No potential secrets found in ${mode}.`)
