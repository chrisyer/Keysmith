import type { ItemCategory, ItemDetail, Vault } from '../types/domain';
import { extractDomain } from '../utils/format';

const PINYIN_TOKENS: Record<string, string> = {
  个人: 'gr geren',
  工作: 'gz gongzuo',
  基础设施: 'jcss jichusheshi',
  开发: 'kf kaifa',
  生产: 'sc shengchan',
  常用: 'cy changyong',
  云服务: 'yfw yunfuwu',
  数据库: 'sjk shujuku',
  银行卡: 'yhk yinhangka',
  信用卡: 'xyk xinyongka',
  招商银行: 'zsyh zhaoshangyinhang',
  服务器: 'fwq fuwuqi',
  身份: 'sf shenfen',
  证件: 'zj zhengjian',
  安全笔记: 'aqbj anquanbiji',
  通行密钥: 'txmy tongxingmiyao passkey fido2',
  硬件密钥: 'yjmy yingjianmiyao',
  合作伙伴: 'hzhb hezuohuoban',
  内网: 'nw neiwang',
  测试: 'cs ceshi',
  代码签名: 'dmqm daimaqianming',
};

const CATEGORY_ALIASES: Record<string, ItemCategory> = {
  login: 'login',
  dl: 'login',
  登录: 'login',
  password: 'password',
  mm: 'password',
  密码: 'password',
  note: 'secure_note',
  secure_note: 'secure_note',
  bj: 'secure_note',
  笔记: 'secure_note',
  card: 'credit_card',
  credit_card: 'credit_card',
  yhk: 'credit_card',
  银行卡: 'credit_card',
  identity: 'identity',
  sf: 'identity',
  身份: 'identity',
  api: 'api_credential',
  api_credential: 'api_credential',
  db: 'database',
  database: 'database',
  sjk: 'database',
  数据库: 'database',
  server: 'server',
  fwq: 'server',
  服务器: 'server',
  ssh: 'ssh_key',
  ssh_key: 'ssh_key',
  license: 'software_license',
  software_license: 'software_license',
  passkey: 'passkey',
  txmy: 'passkey',
  通行密钥: 'passkey',
  bank: 'bank_account',
  bank_account: 'bank_account',
  银行账户: 'bank_account',
  crypto: 'crypto_wallet',
  crypto_wallet: 'crypto_wallet',
  钱包: 'crypto_wallet',
  wifi: 'wifi_router',
  wifi_router: 'wifi_router',
  passport: 'passport',
  护照: 'passport',
  driver: 'driver_license',
  driver_license: 'driver_license',
  驾照: 'driver_license',
  驾驶证: 'driver_license',
  membership: 'membership',
  会员卡: 'membership',
  medical: 'medical_record',
  medical_record: 'medical_record',
  医疗: 'medical_record',
  doc: 'document',
  document: 'document',
  文档: 'document',
};

export interface ParsedSearchQuery {
  tags: string[];
  vaults: string[];
  categories: ItemCategory[];
  favoriteOnly: boolean;
  passkeyOnly: boolean;
  freeTerms: string[];
}

export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    tags: [],
    vaults: [],
    categories: [],
    favoriteOnly: false,
    passkeyOnly: false,
    freeTerms: [],
  };

  const parts = rawQuery.trim().split(/\s+/).filter(Boolean);
  for (const token of parts) {
    const lower = token.toLowerCase();
    if (lower.startsWith('tag:') && token.length > 4) {
      result.tags.push(lower.slice(4));
    } else if (lower.startsWith('vault:') && token.length > 6) {
      result.vaults.push(lower.slice(6));
    } else if (lower.startsWith('cat:') && token.length > 4) {
      const mapped = CATEGORY_ALIASES[lower.slice(4)];
      if (mapped) result.categories.push(mapped);
    } else if (lower === 'is:favorite' || lower === 'is:fav') {
      result.favoriteOnly = true;
    } else if (lower === 'is:passkey') {
      result.passkeyOnly = true;
    } else {
      result.freeTerms.push(lower);
    }
  }
  return result;
}

function expandPinyin(text: string): string {
  const hits: Array<{ pos: number; short: string; full: string }> = [];
  for (const [zh, py] of Object.entries(PINYIN_TOKENS)) {
    const pos = text.indexOf(zh);
    if (pos >= 0) {
      hits.push({ pos, short: py.split(' ')[0] ?? py, full: py });
    }
  }
  hits.sort((a, b) => a.pos - b.pos);

  let initials = '';
  let out = '';
  for (const h of hits) {
    initials += h.short;
    out += ` ${h.full}`;
  }
  return initials ? `${out} ${initials}` : out;
}

function stripEmailDomains(text: string): string {
  return text.replace(/([^\s@]+)@([^\s@]+\.[^\s@]+)/g, '$1');
}

export function scoreSearchQuery(item: ItemDetail, vaults: Vault[], rawQuery: string): number | null {
  if (!rawQuery.trim()) return 0;
  const parsed = parseSearchQuery(rawQuery);
  const vault = vaults.find((v) => v.id === item.vaultId);
  const vaultNameRaw = vault?.name ?? '';
  const vaultName = vaultNameRaw.toLowerCase();

  if (parsed.favoriteOnly && !item.favorite) return null;
  if (parsed.passkeyOnly && (item.passkeys?.length ?? 0) === 0 && item.category !== 'passkey') {
    return null;
  }

  for (const tag of parsed.tags) {
    if (!item.tags.some((t) => t.toLowerCase().includes(tag))) return null;
  }

  const vaultPinyin = expandPinyin(vaultNameRaw);
  for (const v of parsed.vaults) {
    if (!vaultName.includes(v) && !vaultPinyin.includes(v)) return null;
  }

  if (parsed.categories.length > 0 && !parsed.categories.includes(item.category)) {
    return null;
  }

  if (parsed.freeTerms.length === 0) return 100;

  const titleLower = item.title.toLowerCase();
  const titleWithPinyin = `${titleLower}${expandPinyin(item.title)}`;
  const urlHosts = item.urls.map((u) => extractDomain(u.uri).toLowerCase()).filter(Boolean);
  const fullUrls = item.urls.map((u) => u.uri.toLowerCase()).filter(Boolean);
  const passkeyRps = (item.passkeys ?? [])
    .flatMap((p) => [p.rpId.toLowerCase(), p.rpName.toLowerCase()])
    .filter(Boolean);
  const tagsLower = item.tags.map((t) => t.toLowerCase());

  const secondaryParts: string[] = [];
  if (item.subtitle) secondaryParts.push(item.subtitle);
  for (const sec of item.sections) {
    for (const f of sec.fields) {
      if (!f.sensitive && f.value.trim()) secondaryParts.push(f.value);
    }
  }
  for (const pk of item.passkeys ?? []) {
    if (pk.userName) secondaryParts.push(pk.userName);
  }
  const rawSecondary = secondaryParts.join(' ').toLowerCase();
  const strippedSecondary = stripEmailDomains(rawSecondary);

  const notesLower = (item.notes ?? '').toLowerCase();
  const notesStripped = stripEmailDomains(notesLower);
  const vaultCorpus = `${vaultName}${vaultPinyin} ${item.category}`;

  let totalScore = 0;

  for (const term of parsed.freeTerms) {
    let best = 0;

    if (titleLower === term) {
      best = Math.max(best, 1000);
    } else if (titleLower.startsWith(term)) {
      best = Math.max(best, 800);
    } else if (titleWithPinyin.includes(term)) {
      best = Math.max(best, 650);
    }

    if (urlHosts.some((h) => h.includes(term)) || passkeyRps.some((rp) => rp.includes(term))) {
      best = Math.max(best, 550);
    }

    if (fullUrls.some((u) => u.includes(term)) || tagsLower.some((t) => t.includes(term))) {
      best = Math.max(best, 400);
    }

    const allowEmailDomain = term.includes('@');
    if ((allowEmailDomain ? rawSecondary : strippedSecondary).includes(term)) {
      best = Math.max(best, 300);
    }
    if ((allowEmailDomain ? notesLower : notesStripped).includes(term) || vaultCorpus.includes(term)) {
      best = Math.max(best, 180);
    }

    if (best === 0) return null;
    totalScore += best;
  }

  return totalScore;
}

export function matchesSearchQuery(item: ItemDetail, vaults: Vault[], rawQuery: string): boolean {
  return scoreSearchQuery(item, vaults, rawQuery) !== null;
}
