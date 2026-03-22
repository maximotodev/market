import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	authActions,
	NOSTR_AUTO_LOGIN,
	NOSTR_CONNECT_KEY,
	NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY,
	NOSTR_LOCAL_SIGNER_KEY,
} from '@/lib/stores/auth'
import { clearAllMemorySessionSecrets, parsePasswordSecretEnvelope } from '@/lib/security/clientSecretStorage'
import { walletActions } from '@/lib/stores/wallet'

describe('secret persistence hardening', () => {
	beforeEach(() => {
		localStorage.clear()
		sessionStorage.clear()
		clearAllMemorySessionSecrets()
	})

	afterEach(() => {
		localStorage.clear()
		sessionStorage.clear()
		clearAllMemorySessionSecrets()
	})

	test('legacy private key storage is migrated to encrypted envelope and raw nsec does not remain in browser storage', async () => {
		const legacyPrivateKey = 'nsec1legacyprivatekey'
		localStorage.setItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, `${'a'.repeat(64)}:${legacyPrivateKey}`)

		const originalLogin = authActions.loginWithPrivateKey
		authActions.loginWithPrivateKey = async () => ({ pubkey: 'a'.repeat(64) } as any)

		try {
			await authActions.decryptAndLogin('test-password')
		} finally {
			authActions.loginWithPrivateKey = originalLogin
		}

		const storedValue = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		expect(storedValue).toBeTruthy()
		expect(storedValue).not.toContain(legacyPrivateKey)
		expect(parsePasswordSecretEnvelope(storedValue)).not.toBeNull()
	})

	test('legacy NIP-46 plaintext storage is cleaned up only after successful login', async () => {
		localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')
		localStorage.setItem(NOSTR_LOCAL_SIGNER_KEY, '1'.repeat(64))
		localStorage.setItem(NOSTR_CONNECT_KEY, 'bunker://example?relay=wss%3A%2F%2Frelay.test&secret=test')

		const originalLoginWithNip46 = authActions.loginWithNip46
		const originalCheckTerms = authActions.checkAndShowTermsDialog
		authActions.loginWithNip46 = async () => ({ pubkey: 'f'.repeat(64) } as any)
		authActions.checkAndShowTermsDialog = () => {}

		try {
			await authActions.getAuthFromLocalStorageAndLogin()
		} finally {
			authActions.loginWithNip46 = originalLoginWithNip46
			authActions.checkAndShowTermsDialog = originalCheckTerms
		}

		expect(localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)).toBeNull()
		expect(localStorage.getItem(NOSTR_CONNECT_KEY)).toBeNull()
	})

	test('legacy NIP-46 plaintext storage is preserved when login fails', async () => {
		localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')
		localStorage.setItem(NOSTR_LOCAL_SIGNER_KEY, '1'.repeat(64))
		localStorage.setItem(NOSTR_CONNECT_KEY, 'bunker://example?relay=wss%3A%2F%2Frelay.test&secret=test')

		const originalLoginWithNip46 = authActions.loginWithNip46
		authActions.loginWithNip46 = async () => {
			throw new Error('login failed')
		}

		try {
			await authActions.getAuthFromLocalStorageAndLogin()
		} finally {
			authActions.loginWithNip46 = originalLoginWithNip46
		}

		expect(localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)).toBe('1'.repeat(64))
		expect(localStorage.getItem(NOSTR_CONNECT_KEY)).toContain('bunker://')
	})

	test('legacy plaintext wallets are scrubbed from durable storage and dropped after simulated reload because local-only secrets are session-only', async () => {
		const rawNwcUri = 'nostr+walletconnect://aaaa?relay=wss%3A%2F%2Frelay.test&secret=bbbb'
		const wallet = {
			id: 'wallet-1',
			name: 'Wallet 1',
			nwcUri: rawNwcUri,
			pubkey: 'a'.repeat(64),
			relays: ['wss://relay.test'],
			storedOnNostr: false,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}

		localStorage.setItem('nwc_wallets', JSON.stringify([wallet]))
		const firstLoadWallets = await walletActions.loadWalletsFromLocalStorage()

		expect(firstLoadWallets[0]?.nwcUri).toBe(rawNwcUri)
		expect(localStorage.getItem('nwc_wallets')).not.toContain('nostr+walletconnect://')

		clearAllMemorySessionSecrets()
		const secondLoadWallets = await walletActions.loadWalletsFromLocalStorage()
		expect(secondLoadWallets).toEqual([])
	})

	test('saving wallets never leaves raw nostr wallet authority in durable browser storage', () => {
		walletActions.saveWalletsToLocalStorage([
			{
				id: 'wallet-2',
				name: 'Wallet 2',
				nwcUri: 'nostr+walletconnect://cccc?relay=wss%3A%2F%2Frelay.test&secret=dddd',
				pubkey: 'c'.repeat(64),
				relays: ['wss://relay.test'],
				storedOnNostr: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
		])

		expect(localStorage.getItem('nwc_wallets')).not.toContain('nostr+walletconnect://')
	})
})
