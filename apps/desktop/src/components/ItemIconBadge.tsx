import {
  BadgeCheck,
  CreditCard,
  Database,
  FileText,
  Fingerprint,
  Globe,
  KeyRound,
  Server,
  Terminal,
  UserCheck,
  Webhook,
} from 'lucide-react';
import type { ItemCategory, ItemIcon } from '../types/domain';
import { TEMPLATE_MAP } from '../services/templates';

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

interface ItemIconBadgeProps {
  icon?: ItemIcon;
  category: ItemCategory;
  title: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ItemIconBadge({ icon, category, title, size = 'md' }: ItemIconBadgeProps) {
  const sizeClass =
    size === 'sm'
      ? 'w-7 h-7 rounded-lg text-[11px]'
      : size === 'lg'
        ? 'w-12 h-12 rounded-2xl text-[15px]'
        : 'w-9 h-9 rounded-xl text-[12px]';

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 22 : 17;

  if (icon?.kind === 'domain') {
    const brand = DOMAIN_BRANDS[icon.host.toLowerCase()];
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
        style={{ backgroundColor: TEMPLATE_MAP[category].color, color: '#ffffff' }}
        aria-hidden="true"
      >
        {letter}
      </div>
    );
  }

  const color = icon?.kind === 'preset' ? icon.color : TEMPLATE_MAP[category].color;
  const IconComp = (() => {
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
    }
  })();

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
