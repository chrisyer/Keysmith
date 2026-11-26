import {
  BadgeCheck,
  BadgePercent,
  Bitcoin,
  BookUser,
  Car,
  CreditCard,
  Database,
  FileArchive,
  FileText,
  Fingerprint,
  Globe,
  HeartPulse,
  KeyRound,
  Landmark,
  Server,
  Terminal,
  UserCheck,
  Webhook,
  Wifi,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { tauriClient } from '../services/tauriClient';
import { TEMPLATE_MAP } from '../services/templates';
import { useSessionStore } from '../stores/sessionStore';
import type { ItemCategory, ItemIcon } from '../types/domain';

const DOMAIN_BRANDS: Record<string, { bg: string; fg: string; label: string }> = {
  'github.com': { bg: '#24292F', fg: '#FFFFFF', label: 'GH' },
  'aws.amazon.com': { bg: '#232F3E', fg: '#FF9900', label: 'AWS' },
  'cloudflare.com': { bg: '#F38020', fg: '#FFFFFF', label: 'CF' },
  'vercel.com': { bg: '#111111', fg: '#FFFFFF', label: '▲' },
  'linear.app': { bg: '#5E6AD2', fg: '#FFFFFF', label: 'LN' },
  'figma.com': { bg: '#1E1E1E', fg: '#A259FF', label: 'FG' },
  'notion.so': { bg: '#1F1F1F', fg: '#FFFFFF', label: 'N' },
  'apple.com': { bg: '#1D1D1F', fg: '#FFFFFF', label: '' },
  'stripe.com': { bg: '#635BFF', fg: '#FFFFFF', label: 'S' },
  'openai.com': { bg: '#10A37F', fg: '#FFFFFF', label: 'AI' },
  'jetbrains.com': { bg: '#000000', fg: '#FF318C', label: 'JB' },
};

const faviconCache = new Map<string, string | null>();
const faviconInflight = new Map<string, Promise<string | null>>();

function loadFavicon(host: string): Promise<string | null> {
  const key = host.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  if (faviconCache.has(key)) {
    return Promise.resolve(faviconCache.get(key) ?? null);
  }
  const existing = faviconInflight.get(key);
  if (existing) return existing;

  const p = tauriClient
    .faviconFetch(key)
    .then((res) => {
      const valid = res && res.startsWith('data:image/') ? res : null;
      faviconCache.set(key, valid);
      return valid;
    })
    .catch(() => {
      faviconCache.set(key, null);
      return null;
    })
    .finally(() => {
      faviconInflight.delete(key);
    });
  faviconInflight.set(key, p);
  return p;
}

export function getCategoryIconComponent(category: ItemCategory) {
  switch (category) {
    case 'login':
      return Globe;
    case 'password':
      return KeyRound;
    case 'secure_note':
      return FileText;
    case 'credit_card':
      return CreditCard;
    case 'identity':
      return UserCheck;
    case 'api_credential':
      return Webhook;
    case 'database':
      return Database;
    case 'server':
      return Server;
    case 'ssh_key':
      return Terminal;
    case 'software_license':
      return BadgeCheck;
    case 'passkey':
      return Fingerprint;
    case 'bank_account':
      return Landmark;
    case 'crypto_wallet':
      return Bitcoin;
    case 'wifi_router':
      return Wifi;
    case 'passport':
      return BookUser;
    case 'driver_license':
      return Car;
    case 'membership':
      return BadgePercent;
    case 'medical_record':
      return HeartPulse;
    case 'document':
      return FileArchive;
  }
}

interface ItemIconBadgeProps {
  icon?: ItemIcon;
  category: ItemCategory;
  title: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ItemIconBadge({ icon, category, title, size = 'md' }: ItemIconBadgeProps) {
  const faviconEnabled = useSessionStore((s) => s.faviconEnabled);
  const host = icon?.kind === 'domain' ? icon.host.trim().toLowerCase() : '';
  const [faviconSrc, setFaviconSrc] = useState<string | null>(() =>
    host && faviconEnabled ? (faviconCache.get(host) ?? null) : null,
  );
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    if (!host || !faviconEnabled) {
      setFaviconSrc(null);
      return;
    }
    if (faviconCache.has(host)) {
      setFaviconSrc(faviconCache.get(host) ?? null);
      return;
    }
    let active = true;
    void loadFavicon(host).then((uri) => {
      if (active) setFaviconSrc(uri);
    });
    return () => {
      active = false;
    };
  }, [host, faviconEnabled]);

  const sizeClass =
    size === 'sm'
      ? 'w-7 h-7 rounded-lg text-[11px]'
      : size === 'lg'
        ? 'w-12 h-12 rounded-2xl text-[15px]'
        : 'w-9 h-9 rounded-xl text-[12px]';

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 22 : 17;

  if (icon?.kind === 'domain') {
    if (faviconSrc && !imgFailed) {
      return (
        <div
          className={`${sizeClass} shrink-0 flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-1 shadow-xs overflow-hidden`}
          aria-hidden="true"
        >
          <img
            src={faviconSrc}
            alt=""
            className="w-full h-full object-contain rounded-[inherit]"
            onError={() => setImgFailed(true)}
          />
        </div>
      );
    }

    const brand = DOMAIN_BRANDS[host];
    if (brand) {
      return (
        <div
          className={`${sizeClass} shrink-0 flex items-center justify-center font-bold tracking-tight shadow-xs`}
          style={{ backgroundColor: brand.bg, color: brand.fg }}
          aria-hidden="true"
        >
          {brand.label}
        </div>
      );
    }
    const letter = (icon.host[0] || title[0] || 'K').toUpperCase();
    return (
      <div
        className={`${sizeClass} shrink-0 flex items-center justify-center font-semibold shadow-xs`}
        style={{ backgroundColor: (TEMPLATE_MAP[category] ?? TEMPLATE_MAP.login).color, color: '#ffffff' }}
        aria-hidden="true"
      >
        {letter}
      </div>
    );
  }

  const color = icon?.kind === 'preset' ? icon.color : (TEMPLATE_MAP[category] ?? TEMPLATE_MAP.login).color;
  const IconComp = getCategoryIconComponent(category);

  return (
    <div
      className={`${sizeClass} shrink-0 flex items-center justify-center text-white shadow-xs`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      <IconComp size={iconSize} strokeWidth={2.1} />
    </div>
  );
}
