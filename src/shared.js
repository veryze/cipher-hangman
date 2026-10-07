/**
 * SHARED UTILITIES - Cipher Hangman Project
 * Common functions used across cipher-hangman.html and index.html
 */

// ==========================================================================
// MODAL UTILITIES
// ==========================================================================

/**
 * Show a modal overlay by ID
 * @param {string} overlayId - The ID of the modal overlay element
 */
function showModal(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.className = 'modal-overlay show';
    }
}

/**
 * Hide a modal overlay by ID
 * @param {string} overlayId - The ID of the modal overlay element
 */
function hideModal(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.className = 'modal-overlay';
    }
}

/**
 * Setup click-outside-to-close for a modal overlay
 * @param {string} overlayId - The ID of the modal overlay element
 * @param {Function} [onClose] - Optional callback when modal closes
 */
function setupModalClose(overlayId, onClose) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hideModal(overlayId);
                if (onClose) onClose();
            }
        });
    }
}

// ==========================================================================
// STORAGE UTILITIES
// ==========================================================================

const StorageKeys = {
    CIPHER_PREFS: 'cipherHangmanPrefs',
    SELECTED_CIPHERS: 'cipherHangmanSelectedCiphers'
};

/**
 * Get cipher preferences from localStorage
 * @returns {Object} - The enabled ciphers object
 */
function getCipherPrefs(defaults = {}) {
    try {
        const saved = localStorage.getItem(StorageKeys.CIPHER_PREFS);
        if (saved) {
            return { ...defaults, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Failed to parse cipher preferences:', e);
    }
    return defaults;
}

/**
 * Save cipher preferences to localStorage
 * @param {Object} prefs - The enabled ciphers object
 */
function saveCipherPrefs(prefs) {
    localStorage.setItem(StorageKeys.CIPHER_PREFS, JSON.stringify(prefs));
}

/**
 * Get selected ciphers from sessionStorage
 * @returns {Array<string>|null} - Array of cipher types or null if not set
 */
function getSelectedCiphers() {
    try {
        const selected = sessionStorage.getItem(StorageKeys.SELECTED_CIPHERS);
        if (selected) {
            const parsed = JSON.parse(selected);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn('Failed to read selected ciphers:', e);
    }
    return null;
}

/**
 * Save selected ciphers to sessionStorage
 * @param {Array<string>} ciphers - Array of cipher types
 */
function saveSelectedCiphers(ciphers) {
    sessionStorage.setItem(StorageKeys.SELECTED_CIPHERS, JSON.stringify(ciphers));
}

/**
 * Clear all game storage
 */
function clearGameStorage() {
    sessionStorage.clear();
    localStorage.clear();
}

/**
 * Get cipher types from storage or use defaults
 * @param {Object} defaults - Default cipher types
 * @returns {Array<string>} - Array of cipher types to use
 */
function getCipherTypes(defaults = []) {
    const selected = getSelectedCiphers();
    if (selected) return selected;
    return defaults;
}

// ==========================================================================
// CIPHER UTILITIES
// ==========================================================================

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MORSE_MAP = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..'
};

const ENGLISH_FREQ = {
    'A': 0.082, 'B': 0.015, 'C': 0.028, 'D': 0.043, 'E': 0.127,
    'F': 0.022, 'G': 0.020, 'H': 0.061, 'I': 0.070, 'J': 0.002,
    'K': 0.008, 'L': 0.040, 'M': 0.024, 'N': 0.067, 'O': 0.075,
    'P': 0.019, 'Q': 0.001, 'R': 0.060, 'S': 0.063, 'T': 0.091,
    'U': 0.028, 'V': 0.010, 'W': 0.024, 'X': 0.002, 'Y': 0.020,
    'Z': 0.001, ' ': 0.130
};

/**
 * Generate a random Caesar offset (non-zero, ±1 to ±26)
 * @returns {number} Random offset
 */
function randomCaesarOffset() {
    let offset = Math.floor(Math.random() * 52) - 26;
    if (offset === 0) offset = 1;
    if (offset > 26) offset -= 26;
    if (offset < -26) offset += 26;
    return offset;
}

/**
 * Build cipher maps for a given cipher type
 * @param {string} type - Cipher type
 * @param {number} [offset] - Caesar offset (required for caesar)
 * @returns {{cipherMap: Object, reverseCipherMap: Object, name: string}}
 */
function buildCipher(type, offset = 0) {
    const cipherMap = {};
    const reverseCipherMap = {};
    
    if (type === 'a1z26') {
        ALPHABET.forEach((letter, i) => {
            const encoded = String(i + 1);
            cipherMap[letter] = encoded;
            reverseCipherMap[encoded] = letter;
        });
    } else if (type === 'binary') {
        ALPHABET.forEach((letter, i) => {
            const encoded = (i + 1).toString(2).padStart(5, '0');
            cipherMap[letter] = encoded;
            reverseCipherMap[encoded] = letter;
        });
    } else if (type === 'morse') {
        ALPHABET.forEach(letter => {
            const encoded = MORSE_MAP[letter];
            cipherMap[letter] = encoded;
            reverseCipherMap[encoded] = letter;
        });
    } else if (type === 'atbash') {
        const reversed = [...ALPHABET].reverse();
        ALPHABET.forEach((letter, i) => {
            const encoded = reversed[i];
            cipherMap[letter] = encoded;
            reverseCipherMap[encoded] = letter;
        });
    } else if (type === 'rot13') {
        ALPHABET.forEach((letter, i) => {
            const encoded = ALPHABET[(i + 13) % 26];
            cipherMap[letter] = encoded;
            reverseCipherMap[encoded] = letter;
        });
    } else { // caesar
        const normalizedOffset = ((offset % 26) + 26) % 26;
        ALPHABET.forEach((letter, i) => {
            const encoded = ALPHABET[(i + normalizedOffset) % 26];
            cipherMap[letter] = encoded;
            reverseCipherMap[encoded] = letter;
        });
    }
    
    return { cipherMap, reverseCipherMap, name: getCipherName(type, offset) };
}

/**
 * Get display name for a cipher type
 * @param {string} type - Cipher type
 * @param {number} [offset] - Caesar offset
 * @returns {string} Display name
 */
function getCipherName(type, offset = 0) {
    switch (type) {
        case 'rot13': return 'ROT13';
        case 'a1z26': return 'A1Z26';
        case 'atbash': return 'Atbash';
        case 'binary': return 'Binary';
        case 'morse': return 'Morse Code';
        case 'caesar':
        default: return `Caesar (${offset > 0 ? '+' : ''}${offset})`;
    }
}

/**
 * Encode a phrase using the given cipher map
 * @param {string} phrase - The phrase to encode
 * @param {Object} cipherMap - The cipher map
 * @param {string} type - Cipher type (for spacing logic)
 * @returns {string} Encoded phrase
 */
function encodePhrase(phrase, cipherMap, type) {
    const isSpaceSeparated = type === 'a1z26' || type === 'binary' || type === 'morse';
    
    if (isSpaceSeparated) {
        return phrase.split('').map(char => {
            if (char === ' ') return '';
            return cipherMap[char] || char;
        }).filter(t => t !== '').join(' ');
    } else {
        return phrase.split('').map(char => {
            if (char === ' ') return ' ';
            return cipherMap[char] || char;
        }).join('');
    }
}

/**
 * Calculate surprisal of a phrase
 * @param {string} phrase - The phrase
 * @returns {{total: number, average: number, perChar: number}}
 */
function calculateSurprisal(phrase) {
    let totalSurprisal = 0;
    let charCount = 0;
    
    for (const char of phrase) {
        const upperChar = char.toUpperCase();
        const prob = ENGLISH_FREQ[upperChar] || 0.0001;
        const surprisal = -Math.log2(prob);
        totalSurprisal += surprisal;
        charCount++;
    }
    
    return {
        total: totalSurprisal,
        average: totalSurprisal / charCount,
        perChar: charCount
    };
}

/**
 * Calculate remaining entropy of unrevealed letters
 * @param {string} originalPhrase - Original phrase
 * @param {Object} revealed - Object tracking revealed positions
 * @returns {{total: number, average: number, unrevealedCount: number}}
 */
function calculateRemainingEntropy(originalPhrase, revealed) {
    let entropy = 0;
    let unrevealedCount = 0;
    
    for (let i = 0; i < originalPhrase.length; i++) {
        if (originalPhrase[i] !== ' ' && !revealed[i]) {
            const char = originalPhrase[i].toUpperCase();
            const prob = ENGLISH_FREQ[char] || 0.0001;
            entropy += -prob * Math.log2(prob);
            unrevealedCount++;
        }
    }
    
    return {
        total: entropy,
        average: unrevealedCount > 0 ? entropy / unrevealedCount : 0,
        unrevealedCount
    };
}

/**
 * Calculate Shannon entropy of phrase's letter distribution
 * @param {string} phrase - The phrase
 * @returns {number} Entropy in bits
 */
function calculatePhraseEntropy(phrase) {
    const freq = {};
    let total = 0;
    
    for (const char of phrase) {
        if (char !== ' ') {
            const upper = char.toUpperCase();
            freq[upper] = (freq[upper] || 0) + 1;
            total++;
        }
    }
    
    let entropy = 0;
    for (const count of Object.values(freq)) {
        const p = count / total;
        entropy -= p * Math.log2(p);
    }
    
    return entropy;
}

// ==========================================================================
// UI UTILITIES
// ==========================================================================

/**
 * Toggle a panel open/closed
 * @param {HTMLElement} panel - The panel element
 * @param {HTMLElement} [button] - Optional button to toggle active state
 */
function togglePanel(panel, button) {
    panel.classList.toggle('open');
    if (button) {
        button.classList.toggle('active', panel.classList.contains('open'));
    }
}

/**
 * Close all side panels
 * @param {HTMLElement[]} panels - Array of panel elements
 * @param {HTMLElement[]} [buttons] - Optional array of button elements
 */
function closeAllPanels(panels, buttons = []) {
    panels.forEach(p => p.classList.remove('open'));
    buttons.forEach(b => b.classList.remove('active'));
}

// Export for ES modules (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showModal,
        hideModal,
        setupModalClose,
        getCipherPrefs,
        saveCipherPrefs,
        getSelectedCiphers,
        saveSelectedCiphers,
        clearGameStorage,
        getCipherTypes,
        buildCipher,
        getCipherName,
        encodePhrase,
        calculateSurprisal,
        calculateRemainingEntropy,
        calculatePhraseEntropy,
        randomCaesarOffset,
        togglePanel,
        closeAllPanels,
        StorageKeys
    };
}