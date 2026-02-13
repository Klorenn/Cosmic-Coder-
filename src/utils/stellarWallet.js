/**
 * Stellar Wallets Kit integration for Cosmic Coder.
 * Uses the kit's createButton() so the official wallet selector modal always works.
 * @see https://github.com/Creit-Tech/Stellar-Wallets-Kit
 */

let kit = null;
let cachedAddress = null;

const STORAGE_KEY = 'cosmicCoderWalletAddress';

/** Button theme to match game (dark + green) */
const GAME_BUTTON_THEME = {
  bgColor: '#0a0a0f',
  textColor: '#00cc88',
  solidTextColor: '#00ffaa',
  dividerColor: 'rgba(0, 204, 136, 0.3)',
  buttonPadding: '8px 14px',
  buttonBorderRadius: '4px'
};

/**
 * Initialize the kit (call once). Safe to call multiple times.
 * @returns {Promise<object|null>} kit instance or null if load failed
 */
export async function init() {
  if (kit) return kit;
  try {
    const {
      StellarWalletsKit,
      WalletNetwork,
      FreighterModule,
      xBullModule,
      AlbedoModule,
      FREIGHTER_ID
    } = await import('@creit.tech/stellar-wallets-kit');

    kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule()
      ],
      buttonTheme: GAME_BUTTON_THEME
    });

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) cachedAddress = saved;
    } catch (_) {}
    return kit;
  } catch (e) {
    console.warn('Stellar Wallets Kit init failed:', e);
    return null;
  }
}

/**
 * Give extensions (e.g. Freighter) time to inject before the kit checks isAvailable().
 */
async function waitForWallets() {
  try {
    const { isConnected } = await import('@stellar/freighter-api');
    await isConnected().catch(() => {});
  } catch (_) {}
  await new Promise((r) => setTimeout(r, 1200));
}

/**
 * Create the Stellar Wallets Kit button in the given container (doc flow).
 * Call once at startup, e.g. from main.js: createKitButton(document.querySelector('#buttonWrapper')).
 * The kit injects its button; click opens the modal. Sign with getAddress() + signTransaction().
 * @param {HTMLElement} container - e.g. document.querySelector('#buttonWrapper')
 * @param {() => void} [onStateChange] - optional, called when user connects or disconnects
 * @returns {Promise<boolean>} true if button was created
 */
export async function createKitButton(container, onStateChange) {
  await waitForWallets();
  const k = await init();
  if (!k || !container) return false;
  if (k.isButtonCreated()) return true;
  try {
    await k.createButton({
      container,
      buttonText: 'CONNECT WALLET',
      onConnect: (response) => {
        cachedAddress = response.address;
        try {
          localStorage.setItem(STORAGE_KEY, response.address);
        } catch (_) {}
        if (typeof onStateChange === 'function') onStateChange();
      },
      onClosed: (err) => {
        if (err) console.warn('Wallet modal closed:', err);
      },
      onError: (err) => {
        console.warn('Wallet error:', err);
      },
      onDisconnect: () => {
        cachedAddress = null;
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
        if (typeof onStateChange === 'function') onStateChange();
      }
    });
    return true;
  } catch (e) {
    console.warn('Stellar Wallets Kit createButton failed:', e);
    return false;
  }
}

/**
 * Open the wallet modal manually (e.g. if you use your own button). Waits for extensions first.
 * @returns {Promise<string|null>} address if user connected, null otherwise
 */
export async function connect() {
  const k = await init();
  if (!k) return null;
  await waitForWallets();
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };
    k.openModal({
      modalTitle: 'Connect wallet',
      notAvailableText: 'Not installed — click to open install page',
      onWalletSelected: async (option) => {
        try {
          k.setWallet(option.id);
          const { address } = await k.getAddress();
          cachedAddress = address;
          try {
            localStorage.setItem(STORAGE_KEY, address);
          } catch (_) {}
          done(address);
        } catch (err) {
          console.warn('getAddress failed:', err);
          done(null);
        }
      },
      onClosed: () => done(cachedAddress)
    }).catch((err) => {
      console.warn('openModal failed:', err);
      done(null);
    });
  });
}

/**
 * Get current wallet address (from cache or kit). Returns null if not connected.
 */
export async function getAddress() {
  if (cachedAddress) return cachedAddress;
  const k = kit || await init();
  if (!k) return null;
  try {
    const { address } = await k.getAddress();
    cachedAddress = address;
    return address;
  } catch (_) {
    return null;
  }
}

/**
 * Disconnect: clear cache and storage. Kit state may still have wallet selected.
 */
export function disconnect() {
  cachedAddress = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

/**
 * Whether we have an address (connected).
 */
export function isConnected() {
  return !!cachedAddress;
}

/**
 * Short address for UI (e.g. GABC...xyz).
 */
export function shortAddress(address, chars = 6) {
  if (!address || address.length <= chars * 2) return address || '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/**
 * Sign a transaction XDR (for Soroban / Game Hub). Uses current wallet.
 * @param {string} xdr - base64 transaction XDR
 * @param {string} [networkPassphrase] - default testnet
 * @returns {Promise<string>} signed XDR base64
 */
export async function signTransaction(xdr, networkPassphrase = TESTNET_PASSPHRASE) {
  const k = kit || await init();
  const addr = await getAddress();
  if (!k || !addr) throw new Error('Wallet not connected');
  const { signedTxXdr } = await k.signTransaction(xdr, { address: addr, networkPassphrase });
  return signedTxXdr;
}
