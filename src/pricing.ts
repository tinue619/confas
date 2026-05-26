// Расчёт цены фасада по правилам модели + выборам пользователя.

import { unitPrice, materialName } from './materials';
import type { FacadeModel, PriceRule } from './model';
import type { FacadeState } from './state';

export interface LineItem {
  label: string;     // что считается ("Профиль чёрный")
  qty: number;       // количество в единицах rule.unit
  unit: string;      // "м" | "м²" | "шт"
  unitPrice: number; // ₸ за единицу
  total: number;     // qty × unitPrice (до надбавок)
  /** Найден ли материал в каталоге (для предупреждений) */
  resolved: boolean;
  /** Ключ материала (для отладки) */
  key: string;
}

export interface PriceBreakdown {
  items: LineItem[];
  /** Надбавка за закалённое стекло, ₸ */
  temperedSurcharge: number;
  /** Итого, ₸ */
  total: number;
  /** Ключи материалов, которых нет в каталоге */
  missing: string[];
}

export function calcPrice(model: FacadeModel, fs: FacadeState): PriceBreakdown {
  if (!model.pricing) {
    return { items: [], temperedSurcharge: 0, total: 0, missing: [] };
  }

  const items:    LineItem[] = [];
  const missing:  string[]   = [];
  let glassTotal = 0;

  const W = fs.width  / 1000;   // в метрах
  const H = fs.height / 1000;
  const perimeter = 2 * (W + H);
  const area      = W * H;

  // ── Профиль ────────────────────────────────────────────────────────────
  pushLine(items, missing, model.pricing.profile, perimeter, fs, model);

  // ── Стекло ─────────────────────────────────────────────────────────────
  const glassLine = pushLine(items, missing, model.pricing.glass, area, fs, model);
  if (glassLine) glassTotal += glassLine.total;

  // ── Присадки + петли ───────────────────────────────────────────────────
  if (fs.hingeMode !== 'none' && fs.hingePositions.length > 0) {
    pushLine(items, missing, model.pricing.drilling, fs.hingePositions.length, fs, model);
  }
  if (fs.hingeMode === 'holes+hinges' && fs.hingePositions.length > 0) {
    pushLine(items, missing, model.pricing.hinge, fs.hingePositions.length, fs, model);
  }

  // ── Закалка ────────────────────────────────────────────────────────────
  const markup = model.pricing.temperedMarkup ?? 0;
  const temperedSurcharge = fs.tempered ? Math.round(glassTotal * markup) : 0;

  const total = items.reduce((s, i) => s + i.total, 0) + temperedSurcharge;
  return { items, temperedSurcharge, total, missing };
}

// ── Внутреннее: разрешение ключа + добавление строки ──────────────────────────

function pushLine(
  items: LineItem[], missing: string[],
  rule: PriceRule, qty: number, fs: FacadeState, model: FacadeModel,
): LineItem | null {
  if (qty <= 0) return null;
  const key = resolveKey(rule, fs, model);
  const up  = unitPrice(key);
  const unitLabel = rule.unit === 'm' ? 'м' : rule.unit === 'm2' ? 'м²' : 'шт';
  const resolved  = up !== null;
  if (!resolved && !missing.includes(key)) missing.push(key);
  const line: LineItem = {
    label:     materialName(key),
    qty:       round2(qty),
    unit:      unitLabel,
    unitPrice: up ?? 0,
    total:     Math.round((up ?? 0) * qty),
    resolved,
    key,
  };
  items.push(line);
  return line;
}

function resolveKey(rule: PriceRule, fs: FacadeState, model: FacadeModel): string {
  if (rule.key) return rule.key;
  if (!rule.keyPattern) return '???';
  return rule.keyPattern.replace(/\$\{(\w+)\}/g, (_, name) => {
    switch (name) {
      case 'profileColor':   return fs.profileColor;
      case 'glassColor':     return fs.glassColor;
      case 'glassType':      return fs.glassType;
      case 'glassThickness': return String(model.glassThickness);
      default:               return `?${name}?`;
    }
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
