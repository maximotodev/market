import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKUser, NDKEvent } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkActions } from './ndk'
import { cartActions } from './cart'
import { fetchProductsByPubkey } from '@/queries/products'
import { hasAcceptedTerms, TERMS_ACCEPTED_KEY } from '@/components/dialogs/TermsConditionsDialog'
import { uiActions } from './ui'
import { clearAllMemorySessionSecrets, loadPasswordProtectedSecret, savePasswordProtectedSecret } from '@/lib/security/clientSecretStorage'

export const NOSTR_CONNECT_KEY = 'nostr_connect_url'
export const NOSTR_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'
export const NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY = 'nostr_local_encrypted_signer_key'
export const NOSTR_AUTO_LOGIN = 'nostr_auto_login'
export const NOSTR_USER_PUBKEY = 'nostr_user_pubkey'

interface AuthState {
	user: NDKUser | null
	isAuthenticated: boolean
	needsDecryptionPassword: boolean
	isAuthenticating: boolean
}

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	needsDecryptionPassword: false,
	isAuthenticating: false,
}

export const authStore = new Store<AuthState>(initialState)

export function parseLegacyStoredPrivateKey(value: string | null | undefined): { pubkey: string; privateKey: string } | null {
	if (!value || value.trim().startsWith('{')) return null

	const [pubkey, privateKey] = value.split(':')
	if (!pubkey || !privateKey) return null

	return { pubkey, privateKey }
}

function clearLegacyNip46Storage() {
	localStorage.removeItem(NOSTR_LOCAL_SIGNER_KEY)
	localStorage.removeItem(NOSTR_CONNECT_KEY)
}

export const authActions = {
	getAuthFromLocalStorageAndLogin: async () => {
		try {
			const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)
			if (autoLogin !== 'true') return

			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const legacyNip46PrivateKey = localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)
			const legacyBunkerUrl = localStorage.getItem(NOSTR_CONNECT_KEY)
			if (legacyNip46PrivateKey && legacyBunkerUrl) {
				await authActions.loginWithNip46(legacyBunkerUrl, new NDKPrivateKeySigner(legacyNip46PrivateKey))
				clearLegacyNip46Storage()
				authActions.checkAndShowTermsDialog()
				return
			}

			const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			if (encryptedPrivateKey) {
				authStore.setState((state) => ({ ...state, needsDecryptionPassword: true }))
				return
			}

			await authActions.loginWithExtension()
			authActions.checkAndShowTermsDialog()
		} catch (error) {
			console.error('Authentication failed:', error)
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	decryptAndLogin: async (password: string) => {
		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			if (!encryptedPrivateKey) {
				throw new Error('No encrypted key found')
			}

			const legacyStoredKey = parseLegacyStoredPrivateKey(encryptedPrivateKey)
			const key = legacyStoredKey?.privateKey ?? (await loadPasswordProtectedSecret(localStorage, NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, password))
			if (!key) {
				throw new Error('Stored private key is invalid')
			}

			await authActions.loginWithPrivateKey(key)
			if (legacyStoredKey) {
				await authActions.storeEncryptedPrivateKey(key, password, legacyStoredKey.pubkey)
			}
			authStore.setState((state) => ({ ...state, needsDecryptionPassword: false }))
			authActions.checkAndShowTermsDialog()
		} catch (error) {
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	checkAndShowTermsDialog: () => {
		if (!hasAcceptedTerms()) {
			uiActions.openDialog('terms')
		}
	},

	storeEncryptedPrivateKey: async (privateKey: string, password: string, pubkey?: string) => {
		await savePasswordProtectedSecret(localStorage, NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, privateKey, password, { pubkey })
	},

	loginWithPrivateKey: async (privateKey: string) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKPrivateKeySigner(privateKey)
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)

			const user = await signer.user()

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	getAvailableNostrExtensions: (): string[] => {
		const extensions: string[] = []
		if (typeof window !== 'undefined') {
			if ((window as any).nostr) extensions.push('nostr')
			if ((window as any).nos2x) extensions.push('nos2x')
			if ((window as any).alby) extensions.push('alby')
		}
		return extensions
	},

	loginWithExtension: async () => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		// Check if extensions are available before attempting login
		const availableExtensions = authActions.getAvailableNostrExtensions()
		if (availableExtensions.length === 0) {
			throw new Error('No Nostr extension detected. Please install a Nostr browser extension (e.g., Alby, nos2x) before logging in.')
		}

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKNip07Signer()
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)

			const user = await signer.user()

			if (!user || !user.pubkey) {
				throw new Error('Failed to authenticate with Nostr extension. Please make sure your extension is unlocked and try again.')
			}

			// Store user pubkey and enable auto-login for persistence
			localStorage.setItem(NOSTR_USER_PUBKEY, user.pubkey)
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithNip46: async (bunkerUrl: string, localSigner: NDKPrivateKeySigner) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKNip46Signer(ndk, bunkerUrl, localSigner)
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)
			const user = await signer.user()

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	logout: () => {
		const ndk = ndkActions.getNDK()
		if (!ndk) return
		ndkActions.removeSigner()
		clearLegacyNip46Storage()
		localStorage.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		localStorage.removeItem(NOSTR_AUTO_LOGIN)
		clearAllMemorySessionSecrets()
		// Clear cart when user logs out
		cartActions.clear()
		authStore.setState(() => initialState)
	},

	userHasProducts: async (): Promise<boolean> => {
		const state = authStore.state
		if (!state.user) return false

		try {
			const products = await fetchProductsByPubkey(state.user.pubkey)
			return products.length > 0
		} catch (error) {
			console.error('Failed to check user products:', error)
			return false
		}
	},
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
