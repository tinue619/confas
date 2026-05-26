// Авто-загрузка моделей из /models/<category>/*.json.
// Положил новый .json — Vite его подхватит при пересборке.

import type { Category, CatalogEntry, FacadeModel } from './model';

const modules = import.meta.glob('/models/*/*.json', { eager: true }) as Record<string, { default: FacadeModel }>;

export const CATALOG: CatalogEntry[] = Object.entries(modules)
  .map(([path, mod]) => {
    // path вида '/models/facade/wide.json'
    const m = path.match(/\/models\/([^/]+)\/([^/]+)\.json$/);
    if (!m) return null;
    const category = m[1] as Category;
    const id       = m[2];
    return { category, id, model: mod.default };
  })
  .filter((e): e is CatalogEntry => e !== null);

export function modelsByCategory(category: Category): CatalogEntry[] {
  return CATALOG.filter(e => e.category === category)
    .sort((a, b) => a.model.name.localeCompare(b.model.name));
}

export function categoryHasModels(category: Category): boolean {
  return CATALOG.some(e => e.category === category);
}
