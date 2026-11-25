import type { GeneratorOptions, GeneratorResult, PasswordStrength } from '../types/domain';

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const LOWER_FULL = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const UPPER_FULL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '23456789';
const DIGITS_FULL = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+?';

const WORD_LIST = [
  'amber', 'anchor', 'alpine', 'apricot', 'atlas', 'aurora', 'bamboo', 'beacon',
  'birch', 'blossom', 'breeze', 'bridge', 'bronze', 'canyon', 'cedar', 'cinder',
  'citadel', 'clover', 'cobalt', 'compass', 'copper', 'coral', 'cosmos', 'crater',
  'crimson', 'crystal', 'cypress', 'dawn', 'delta', 'dolphin', 'dragon', 'drift',
  'echo', 'eclipse', 'emerald', 'ember', 'falcon', 'feather', 'fern', 'fjord',
  'flint', 'forest', 'forge', 'fossil', 'fountain', 'frost', 'galaxy', 'garden',
  'garnet', 'glacier', 'glade', 'granite', 'harbor', 'harvest', 'haven', 'hazel',
  'hearth', 'helium', 'horizon', 'indigo', 'iris', 'island', 'ivory', 'jade',
  'jasper', 'juniper', 'kestrel', 'keystone', 'lagoon', 'lantern', 'larch', 'laurel',
  'legend', 'lichen', 'linen', 'lotus', 'lunar', 'lynx', 'magnet', 'maple',
  'marble', 'meadow', 'mercury', 'meteor', 'mirage', 'monarch', 'mosaic', 'moss',
  'nebula', 'nectar', 'nickel', 'nimbus', 'north', 'oak', 'oasis', 'obsidian',
  'ocean', 'ochre', 'olive', 'onyx', 'opal', 'orbit', 'orchid', 'osprey',
  'otter', 'oxide', 'pacific', 'palace', 'panther', 'papyrus', 'paragon', 'pebble',
  'pelican', 'pepper', 'petal', 'phantom', 'phoenix', 'photon', 'pine', 'pioneer',
  'planet', 'plaza', 'plum', 'polar', 'poplar', 'prism', 'pulse', 'quartz',
  'quiver', 'radium', 'rain', 'raven', 'redwood', 'reef', 'relic', 'ripple',
  'river', 'robin', 'rocket', 'saffron', 'sage', 'salmon', 'sapphire', 'saturn',
  'scarlet', 'sequoia', 'shadow', 'sierra', 'silver', 'slate', 'solstice', 'sonar',
  'sparrow', 'spectra', 'sphinx', 'spruce', 'starlight', 'summit', 'sunbeam', 'sundial',
  'sunrise', 'swift', 'sycamore', 'talon', 'tangerine', 'temple', 'thistle', 'thunder',
  'timber', 'topaz', 'torrent', 'trident', 'tundra', 'turmeric', 'umbra', 'valley',
  'velvet', 'verbena', 'vertex', 'vesper', 'violet', 'voyager', 'walnut', 'whisper',
  'willow', 'winter', 'wisteria', 'zenith', 'zephyr', 'zircon',
];

function randomInt(max: number): number {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / max) * max;
  let n = 0;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return n % max;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: '空密码', entropyBits: 0 };
  }

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 32;

  const uniqueChars = new Set(password).size;
  const effectiveLen = Math.min(password.length, uniqueChars * 1.45);
  let entropy = Math.round(effectiveLen * Math.log2(Math.max(pool, 2)));

  // Common weak patterns penalty
  const lower = password.toLowerCase();
  if (
    password.length < 10 ||
    /^(password|admin|qwerty|123456|summer|welcome|letmein)/i.test(lower) ||
    /(.)\1{2,}/.test(password)
  ) {
    entropy = Math.min(entropy, 38);
  }
  if (/^[a-zA-Z]+\d{1,4}[!?.]?$/.test(password) && password.length <= 12) {
    entropy = Math.min(entropy, 44);
  }

  let score: 0 | 1 | 2 | 3 | 4 = 0;
  let label = '极弱';
  if (entropy >= 80) {
    score = 4;
    label = '极强';
  } else if (entropy >= 60) {
    score = 3;
    label = '强';
  } else if (entropy >= 45) {
    score = 2;
    label = '中等';
  } else if (entropy >= 28) {
    score = 1;
    label = '较弱';
  }

  return { score, label, entropyBits: entropy };
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  mode: 'password',
  length: 20,
  includeDigits: true,
  includeSymbols: true,
  excludeAmbiguous: true,
  wordCount: 4,
  separator: '-',
  capitalize: true,
  includeNumberInPhrase: true,
  pinLength: 6,
};

export function generateSecret(options: GeneratorOptions): GeneratorResult {
  if (options.mode === 'pin') {
    const len = Math.min(12, Math.max(4, options.pinLength));
    let pin = '';
    for (let i = 0; i < len; i += 1) {
      pin += DIGITS_FULL[randomInt(DIGITS_FULL.length)];
    }
    return {
      value: pin,
      strength: evaluatePasswordStrength(pin),
    };
  }

  if (options.mode === 'passphrase') {
    const count = Math.min(8, Math.max(3, options.wordCount));
    const words: string[] = [];
    for (let i = 0; i < count; i += 1) {
      let word = WORD_LIST[randomInt(WORD_LIST.length)];
      if (options.capitalize) {
        word = word[0].toUpperCase() + word.slice(1);
      }
      words.push(word);
    }
    if (options.includeNumberInPhrase) {
      const targetIdx = randomInt(words.length);
      words[targetIdx] = `${words[targetIdx]}${randomInt(90) + 10}`;
    }
    const value = words.join(options.separator);
    return {
      value,
      strength: evaluatePasswordStrength(value),
    };
  }

  const len = Math.min(64, Math.max(8, options.length));
  const lower = options.excludeAmbiguous ? LOWER : LOWER_FULL;
  const upper = options.excludeAmbiguous ? UPPER : UPPER_FULL;
  const digits = options.excludeAmbiguous ? DIGITS : DIGITS_FULL;

  const groups = [lower, upper];
  if (options.includeDigits) groups.push(digits);
  if (options.includeSymbols) groups.push(SYMBOLS);

  const allChars = groups.join('');
  const chars: string[] = [];

  for (const g of groups) {
    chars.push(g[randomInt(g.length)]);
  }
  while (chars.length < len) {
    chars.push(allChars[randomInt(allChars.length)]);
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  const value = chars.join('');
  return {
    value,
    strength: evaluatePasswordStrength(value),
  };
}
