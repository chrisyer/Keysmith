import type { ItemCategory, ItemDetail, Vault } from '../types/domain';

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

function buildSearchCorpus(item: ItemDetail, vaultName: string): string {
  const fieldsText = item.sections
    .flatMap((s) => s.fields)
    .filter((f) => !f.sensitive)
    .map((f) => `${f.label} ${f.value}`)
    .join(' ');
  const urlsText = item.urls.map((u) => u.uri).join(' ');
  const passkeysText = (item.passkeys ?? []).map((p) => `${p.rpId} ${p.rpName} ${p.userName}`).join(' ');
  const base = `${item.title} ${item.subtitle ?? ''} ${vaultName} ${item.category} ${item.tags.join(' ')} ${urlsText} ${passkeysText} ${fieldsText} ${item.notes}`.toLowerCase();

  let pinyinExtras = '';
  for (const [zh, py] of Object.entries(PINYIN_TOKENS)) {
    if (base.includes(zh)) {
      pinyinExtras += ` ${py}`;
    }
  }
  return `${base}${pinyinExtras}`;
}

export function matchesSearchQuery(item: ItemDetail, vaults: Vault[], rawQuery: string): boolean {
  if (!rawQuery.trim()) return true;
  const parsed = parseSearchQuery(rawQuery);
  const vault = vaults.find((v) => v.id === item.vaultId);
  const vaultName = vault?.name.toLowerCase() ?? '';

  if (parsed.favoriteOnly && !item.favorite) {
    return false;
  }

  if (parsed.passkeyOnly && (item.passkeys?.length ?? 0) === 0 && item.category !== 'passkey') {
    return false;
  }

  for (const tag of parsed.tags) {
    if (!item.tags.some((t) => t.toLowerCase().includes(tag))) {
      return false;
    }
  }

  for (const v of parsed.vaults) {
    const vPinyin = PINYIN_TOKENS[vault?.name ?? ''] ?? '';
    if (!vaultName.includes(v) && !vPinyin.includes(v)) {
      return false;
    }
  }

  if (parsed.categories.length > 0 && !parsed.categories.includes(item.category)) {
    return false;
  }

  if (parsed.freeTerms.length === 0) return true;
  const corpus = buildSearchCorpus(item, vault?.name ?? '');
  return parsed.freeTerms.every((term) => corpus.includes(term));
}
