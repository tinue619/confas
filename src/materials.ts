// Каталог материалов — единственный источник цен.
// Файл config/materials.json подгружается через Vite (тип JSON).

import raw from '../config/materials.json';

export interface Material {
  name: string;
  /** Закупочная цена, ₸ за единицу */
  purchase: number;
  /** Коэффициент наценки (unit = purchase × k) */
  k: number;
}

const MATERIALS = raw as Record<string, Material>;

/** Цена продажи единицы материала по ключу. Если ключ не найден — null. */
export function unitPrice(key: string): number | null {
  const m = MATERIALS[key];
  if (!m) return null;
  return m.purchase * m.k;
}

export function materialName(key: string): string {
  return MATERIALS[key]?.name ?? key;
}

export function hasMaterial(key: string): boolean {
  return key in MATERIALS;
}
