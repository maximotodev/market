class MemoryStorage implements Storage {
	private store = new Map<string, string>()

	get length() {
		return this.store.size
	}

	clear(): void {
		this.store.clear()
	}

	getItem(key: string): string | null {
		return this.store.get(key) ?? null
	}

	key(index: number): string | null {
		return Array.from(this.store.keys())[index] ?? null
	}

	removeItem(key: string): void {
		this.store.delete(key)
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value)
	}
}

if (!globalThis.localStorage) {
	Object.defineProperty(globalThis, 'localStorage', {
		value: new MemoryStorage(),
		configurable: true,
	})
}

if (!globalThis.sessionStorage) {
	Object.defineProperty(globalThis, 'sessionStorage', {
		value: new MemoryStorage(),
		configurable: true,
	})
}
