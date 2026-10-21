/**
 * The Knowledge Vault in the browser: engine, graph index and vault app in the
 * page, no server. Browser-only.
 */
export { BrowserVault, loadGuideVaultSeed, type AiKind, type BrowserVaultProps, type TryEvent, type VaultReady } from "./BrowserVault.js";
export { bootBrowserVault, deleteBrowserVault, type BootedVault, type BootOptions } from "./boot.js";
export type { VaultSeed, VaultSeedDocument, VaultSeedNode, VaultSeedRelationship } from "./seed.js";
