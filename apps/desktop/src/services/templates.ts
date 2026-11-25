import type { ItemCategory, ItemDraft } from '../types/domain';
import { makeId } from '../utils/format';

export interface TemplateMeta {
  category: ItemCategory;
  label: string;
  shortLabel: string;
  description: string;
  iconName: string;
  color: string;
  order: number;
}

export const PHASE1_TEMPLATES: TemplateMeta[] = [
  {
    category: 'login',
    label: '登录',
    shortLabel: '登录',
    description: '网站与应用的账号、密码、TOTP 与网址',
    iconName: 'globe',
    color: '#0572EC',
    order: 1,
  },
  {
    category: 'password',
    label: '密码',
    shortLabel: '密码',
    description: '独立口令或本地加密密钥',
    iconName: 'key',
    color: '#7C3AED',
    order: 2,
  },
  {
    category: 'secure_note',
    label: '安全笔记',
    shortLabel: '安全笔记',
    description: '支持 Markdown 的加密文本与备忘',
    iconName: 'file-text',
    color: '#D97706',
    order: 3,
  },
  {
    category: 'credit_card',
    label: '银行卡',
    shortLabel: '银行卡',
    description: '信用卡、借记卡、有效期与 CVV',
    iconName: 'credit-card',
    color: '#0D9488',
    order: 4,
  },
  {
    category: 'api_credential',
    label: 'API 凭证',
    shortLabel: 'API 凭证',
    description: 'API Key、Secret、Scope 与接口地址',
    iconName: 'webhook',
    color: '#2563EB',
    order: 5,
  },
  {
    category: 'database',
    label: '数据库',
    shortLabel: '数据库',
    description: 'PostgreSQL / MySQL / Redis 连接凭据',
    iconName: 'database',
    color: '#0891B2',
    order: 6,
  },
  {
    category: 'server',
    label: '服务器',
    shortLabel: '服务器',
    description: '主机 IP、端口、Root 密码与托管面板',
    iconName: 'server',
    color: '#4F46E5',
    order: 7,
  },
  {
    category: 'ssh_key',
    label: 'SSH 密钥',
    shortLabel: 'SSH 密钥',
    description: '公钥、私钥、口令与 SHA256 指纹',
    iconName: 'terminal',
    color: '#16A34A',
    order: 8,
  },
  {
    category: 'identity',
    label: '身份信息',
    shortLabel: '身份信息',
    description: '姓名、联系方式与身份证/护照号',
    iconName: 'user-check',
    color: '#DB2777',
    order: 9,
  },
  {
    category: 'software_license',
    label: '软件许可',
    shortLabel: '软件许可',
    description: 'License Key、订单号与到期日期',
    iconName: 'badge-check',
    color: '#EA580C',
    order: 10,
  },
];

const PASSKEY_META: TemplateMeta = {
  category: 'passkey',
  label: '通行密钥',
  shortLabel: '通行密钥',
  description: '由网站 WebAuthn 注册自动保存的免密登录凭据',
  iconName: 'fingerprint',
  color: '#0EA5E9',
  order: 11,
};

export const TEMPLATE_MAP: Record<ItemCategory, TemplateMeta> = {
  ...PHASE1_TEMPLATES.reduce(
    (acc, item) => {
      acc[item.category] = item;
      return acc;
    },
    {} as Record<ItemCategory, TemplateMeta>,
  ),
  passkey: PASSKEY_META,
};

export function createEmptyDraft(category: ItemCategory, vaultId: string): ItemDraft {
  const meta = TEMPLATE_MAP[category];
  const base: ItemDraft = {
    vaultId,
    title: `新建${meta.label}`,
    favorite: false,
    category,
    icon: { kind: 'preset', name: meta.iconName, color: meta.color },
    tags: [],
    urls: [],
    sections: [],
    passkeys: [],
    notes: '',
    passwordHistory: [],
    watchtower: {
      ignoreWeak: false,
      ignoreReused: false,
      ignoreMissing2fa: false,
      ignoreUnsecuredUrl: false,
    },
  };

  switch (category) {
    case 'login':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: '登录页', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '用户名', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: '密码', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: '一次性密码', fieldType: 'totp', value: '', sensitive: true, copyable: true, purpose: 'totp' },
            ],
          },
        ],
      };

    case 'password':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: '关联地址', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '密码', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
        ],
      };

    case 'secure_note':
      return {
        ...base,
        sections: [{ id: makeId('sec'), title: '', fields: [] }],
      };

    case 'credit_card':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '持卡人', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '卡号', fieldType: 'number', value: '', sensitive: true, copyable: true, purpose: 'card_number' },
              { id: makeId('f'), label: '有效期', fieldType: 'month_year', value: '', sensitive: false, copyable: true, purpose: 'card_expiry' },
              { id: makeId('f'), label: '安全码 CVV', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'card_cvv' },
              { id: makeId('f'), label: '卡类型', fieldType: 'text', value: 'Visa', sensitive: false, copyable: false },
            ],
          },
          {
            id: makeId('sec'),
            title: '账单信息',
            fields: [
              { id: makeId('f'), label: '银行名称', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'ATM PIN', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'pin' },
              { id: makeId('f'), label: '客服电话', fieldType: 'phone', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'identity':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '姓', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '名', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '性别', fieldType: 'text', value: '', sensitive: false, copyable: false },
              { id: makeId('f'), label: '出生日期', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '公司 / 职位', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: '联系方式',
            fields: [
              { id: makeId('f'), label: '邮箱', fieldType: 'email', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: '手机', fieldType: 'phone', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '地址', fieldType: 'address', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: '证件号',
            fields: [
              { id: makeId('f'), label: '身份证 / 社保号', fieldType: 'password', value: '', sensitive: true, copyable: true },
            ],
          },
        ],
      };

    case 'api_credential':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: '接口基址', matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '用户名 / AppID', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'API Key', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'API Secret', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: '权限与有效期',
            fields: [
              { id: makeId('f'), label: 'Scope', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '过期时间', fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'database':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '类型', fieldType: 'text', value: 'PostgreSQL', sensitive: false, copyable: true },
              { id: makeId('f'), label: '主机', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '端口', fieldType: 'number', value: '5432', sensitive: false, copyable: true },
              { id: makeId('f'), label: '数据库名', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '用户名', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: '密码', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: '连接串',
            fields: [
              { id: makeId('f'), label: 'Connection URI', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'SSL 模式', fieldType: 'text', value: 'require', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'server':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: '面板网址', matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '主机 / IP', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '端口', fieldType: 'number', value: '22', sensitive: false, copyable: true },
              { id: makeId('f'), label: '用户名', fieldType: 'text', value: 'root', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: '密码', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: 'Root / Admin 密码', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: '托管商',
            fields: [
              { id: makeId('f'), label: '控制台账号', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '所在机房', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'ssh_key':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '公钥', fieldType: 'ssh_public_key', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '私钥', fieldType: 'ssh_private_key', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: '密钥口令 Passphrase', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: '指纹', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'software_license':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: '下载页', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '许可证密钥', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: '注册邮箱', fieldType: 'email', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: '版本', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: '购买信息',
            fields: [
              { id: makeId('f'), label: '购买日期', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '到期日期', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '订单号', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'passkey':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: '关联站点', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: '依赖方域名 (RP ID)', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '依赖方名称', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: '账户名', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
            ],
          },
        ],
      };
  }
}
