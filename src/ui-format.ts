// Общие хелперы рендера, используемые и в редакторе (app.ts), и в кабинете.

import { PROFILE_COLORS, GLASS_COLORS } from './catalog';
import type { FacadeConfig } from './order';

export function fmtMoney(n: number): string {
  return n.toLocaleString('ru-KZ') + ' ₸';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}

/** Краткая спецификация: закалка + петли (для строк корзины/заказа). */
export function compactSpec(c: FacadeConfig): string {
  const parts: string[] = [];
  if (c.tempered) parts.push('закал.');
  if (c.hingeMode !== 'none' && c.hingePositions.length > 0) {
    const arrow = { left: '←', right: '→', top: '↑', bottom: '↓' }[c.hingeSide];
    parts.push(`петли${arrow}${c.hingePositions.length}`);
  }
  return parts.join(' · ');
}

/** SVG-пиктограмма фасада: рама цветом профиля, стекло цветом + текстура. */
export function facadeIcon(c: FacadeConfig, uid: string): string {
  const profileHex = PROFILE_COLORS[c.profileColor]?.hex ?? '#888';
  const glassHex = GLASS_COLORS[c.glassColor]?.hex ?? '#c4d8de';
  const matte = c.glassType === 'matte';
  const textured = c.glassType === 'textured';
  const W = 20, H = 26, fw = 2.5;
  const ix = fw, iy = fw, iw = W - 2 * fw, ih = H - 2 * fw;
  const rgba = (hex: string, a: number) => {
    const m = hex.replace('#', '');
    return `rgba(${parseInt(m.slice(0,2),16)},${parseInt(m.slice(2,4),16)},${parseInt(m.slice(4,6),16)},${a})`;
  };
  const glassAlpha = matte ? 0.7 : 0.4;
  let glassLayer: string;
  if (textured) {
    const pid = `tx-${uid}`;
    glassLayer = `
      <defs>
        <pattern id="${pid}" width="2.2" height="${ih}" patternUnits="userSpaceOnUse">
          <rect width="2.2" height="${ih}" fill="${rgba(glassHex, 0.4)}"/>
          <rect width="1" height="${ih}" fill="${rgba(glassHex, 0.75)}"/>
        </pattern>
      </defs>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="#0d0c0b"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="url(#${pid})"/>`;
  } else {
    glassLayer = `
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="#0d0c0b"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="${rgba(glassHex, glassAlpha)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="cart-facade-icon" aria-hidden="true">
    <rect width="${W}" height="${H}" fill="${profileHex}"/>
    ${glassLayer}
    <rect x="0.5" y="0.5" width="${W-1}" height="${H-1}" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
  </svg>`;
}
