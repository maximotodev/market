//#region plugins/types.ts
/**
* Error thrown when a plugin attempts to register an extension key that is already registered.
*/
var ExtensionRegistrationError = class extends Error {
	constructor(pluginName, key) {
		super(`Plugin "${pluginName}" attempted to register extension "${key}", but it is already registered`);
		this.name = "ExtensionRegistrationError";
	}
};
/**
* Error thrown when the same plugin instance is registered more than once.
*/
var DuplicatePluginRegistrationError = class extends Error {
	constructor(pluginName) {
		super(`Plugin "${pluginName}" is already registered`);
		this.name = "DuplicatePluginRegistrationError";
	}
};

//#endregion
export { ExtensionRegistrationError as n, DuplicatePluginRegistrationError as t };