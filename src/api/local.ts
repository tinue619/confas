// Локальная реализация Api: каталог из бандла, корзина в localStorage.
// Когда поднимем сервер — пишем `httpApi` с теми же сигнатурами и меняем
// `api` в `./index.ts` на новый импорт. Consumer'ы не правим.

import type { CatalogEntry } from '../model';
import { CATALOG } from '../models-loader';
import type { Order, OrderItem } from '../order';
import { emptyOrder } from '../order';
import type { Api, CatalogApi, CartApi, MaterialDto, OrdersApi } from './index';
import materialsRaw from '../../config/materials.json';

const KEY = 'facade-order-v1';
const listeners = new Set<() => void>();
let order: Order = loadOrder();

function loadOrder(): Order {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyOrder();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return emptyOrder();
    return parsed as Order;
  } catch {
    return emptyOrder();
  }
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify(order));
  listeners.forEach(fn => fn());
}

const catalog: CatalogApi = {
  async fetchModels(): Promise<CatalogEntry[]> {
    return CATALOG;
  },
  async fetchMaterials(): Promise<Record<string, MaterialDto>> {
    return materialsRaw as Record<string, MaterialDto>;
  },
};

const cart: CartApi = {
  get: () => order,
  add(item: OrderItem) {
    order.items.push(item);
    persist();
  },
  update(id: string, updater: (it: OrderItem) => OrderItem) {
    const idx = order.items.findIndex(i => i.id === id);
    if (idx < 0) return;
    order.items[idx] = updater(order.items[idx]);
    persist();
  },
  setQty(id: string, qty: number) {
    const it = order.items.find(i => i.id === id);
    if (!it) return;
    it.qty = Math.max(1, Math.round(qty));
    persist();
  },
  remove(id: string) {
    order.items = order.items.filter(i => i.id !== id);
    persist();
  },
  clear() {
    order = emptyOrder();
    persist();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },
};

const orders: OrdersApi = {
  async submit(_order: Order) {
    // Сервера нет — генерим псевдо-ID и считаем total на клиенте.
    const serverId = 'local-' + Date.now().toString(36);
    const total = _order.items.reduce(
      (s, it) => s + it.priceSnapshot.total * it.qty, 0,
    );
    return { serverId, total };
  },
  async getStatus(_serverId: string): Promise<Order> {
    throw new Error('Сервер ещё не подключён — статусы заказа недоступны');
  },
};

export const localApi: Api = { catalog, cart, orders };
