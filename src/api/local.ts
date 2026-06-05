// Локальная реализация Api: каталог из бандла, корзина в localStorage.
// Когда поднимем сервер — пишем `httpApi` с теми же сигнатурами и меняем
// `api` в `./index.ts` на новый импорт. Consumer'ы не правим.

import type { CatalogEntry } from '../model';
import { CATALOG } from '../models-loader';
import type { Customer, Order, OrderHeader, OrderItem, SavedAddress } from '../order';
import type { Api, CatalogApi, MaterialDto, OrdersApi, ProfileApi } from './index';
import materialsRaw from '../../config/materials.json';

const CART_KEY    = 'facade-order-v1';   // legacy: одиночная корзина (мигрируем)
const PROFILE_KEY = 'facade-profile-v1';
const ORDERS_KEY  = 'facade-orders-v1';

const profileListeners = new Set<() => void>();
const ordersListeners  = new Set<() => void>();

let profile: Customer | null = loadProfile();
let orders: Order[] = loadOrders();
migrateLegacyCart();

function newClientId(prefix: string) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Старая одиночная корзина (`facade-order-v1`) → черновик в едином списке. */
function migrateLegacyCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      orders.unshift({
        clientId: newClientId('o'),
        state: 'draft',
        items: parsed.items,
      });
      persistOrders();
    }
    localStorage.removeItem(CART_KEY);
  } catch { /* ignore */ }
}

function loadProfile(): Customer | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== 'string' || typeof parsed.phone !== 'string') return null;
    if (!Array.isArray(parsed.addresses)) parsed.addresses = [];
    return parsed as Customer;
  } catch { return null; }
}

function persistProfile() {
  if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  else         localStorage.removeItem(PROFILE_KEY);
  profileListeners.forEach(fn => fn());
}

function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Order[];
  } catch { return []; }
}

function persistOrders() {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  ordersListeners.forEach(fn => fn());
}

function findOrder(id: string): Order | undefined {
  return orders.find(o => o.clientId === id || o.serverId === id);
}

const catalog: CatalogApi = {
  async fetchModels(): Promise<CatalogEntry[]> {
    return CATALOG;
  },
  async fetchMaterials(): Promise<Record<string, MaterialDto>> {
    return materialsRaw as Record<string, MaterialDto>;
  },
};

const ordersApi: OrdersApi = {
  list(): Order[] {
    return orders;
  },
  get(id: string): Order | null {
    return findOrder(id) ?? null;
  },
  createDraft(): Order {
    const draft: Order = {
      clientId: newClientId('o'),
      state: 'draft',
      items: [],
    };
    orders.unshift(draft);
    persistOrders();
    return draft;
  },
  addItem(orderId: string, item: OrderItem) {
    const o = findOrder(orderId);
    if (!o) return;
    o.items.push(item);
    persistOrders();
  },
  updateItem(orderId: string, itemId: string, updater: (it: OrderItem) => OrderItem) {
    const o = findOrder(orderId);
    if (!o) return;
    const idx = o.items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    o.items[idx] = updater(o.items[idx]);
    persistOrders();
  },
  setQty(orderId: string, itemId: string, qty: number) {
    const o = findOrder(orderId);
    if (!o) return;
    const it = o.items.find(i => i.id === itemId);
    if (!it) return;
    it.qty = Math.max(1, Math.round(qty));
    persistOrders();
  },
  removeItem(orderId: string, itemId: string) {
    const o = findOrder(orderId);
    if (!o) return;
    o.items = o.items.filter(i => i.id !== itemId);
    persistOrders();
  },
  deleteOrder(orderId: string) {
    orders = orders.filter(o => o.clientId !== orderId && o.serverId !== orderId);
    persistOrders();
  },
  async submit(orderId: string, header: OrderHeader): Promise<Order> {
    const o = findOrder(orderId);
    if (!o) throw new Error('Заказ не найден');
    o.serverId = o.serverId ?? newClientId('local');  // сервера нет
    o.state = 'confirmed';
    o.header = header;
    o.submittedAt = new Date().toISOString();
    // Поднимаем оформленный заказ наверх списка.
    orders = [o, ...orders.filter(x => x !== o)];
    persistOrders();
    return o;
  },
  subscribe(fn: () => void): () => void {
    ordersListeners.add(fn);
    return () => { ordersListeners.delete(fn); };
  },
  newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },
};

const profileApi: ProfileApi = {
  get: () => profile,
  register(name: string, phone: string): Customer {
    profile = {
      id: newClientId('c'),
      name: name.trim(),
      phone: phone.trim(),
      addresses: [],
      createdAt: new Date().toISOString(),
    };
    persistProfile();
    return profile;
  },
  update(patch) {
    if (!profile) return;
    if (patch.name  !== undefined) profile.name  = patch.name.trim();
    if (patch.phone !== undefined) profile.phone = patch.phone.trim();
    persistProfile();
  },
  saveAddress(addr): SavedAddress {
    if (!profile) throw new Error('Сначала зарегистрируйтесь');
    const withId: SavedAddress = 'id' in addr && addr.id
      ? addr
      : { ...addr, id: newClientId('a') };
    const idx = profile.addresses.findIndex(a => a.id === withId.id);
    if (idx >= 0) profile.addresses[idx] = withId;
    else          profile.addresses.push(withId);
    persistProfile();
    return withId;
  },
  removeAddress(id: string) {
    if (!profile) return;
    profile.addresses = profile.addresses.filter(a => a.id !== id);
    persistProfile();
  },
  subscribe(fn: () => void): () => void {
    profileListeners.add(fn);
    return () => { profileListeners.delete(fn); };
  },
};

export const localApi: Api = { catalog, orders: ordersApi, profile: profileApi };
