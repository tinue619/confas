// Хранилище заказа: localStorage + подписчики (для обновления индикатора в шапке).

import { emptyOrder, type Order, type OrderItem } from './order';

const KEY = 'facade-order-v1';
const listeners = new Set<() => void>();

let order: Order = load();

function load(): Order {
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

export function getOrder(): Order {
  return order;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addItem(item: OrderItem) {
  order.items.push(item);
  persist();
}

export function updateItem(id: string, updater: (it: OrderItem) => OrderItem) {
  const idx = order.items.findIndex(i => i.id === id);
  if (idx < 0) return;
  order.items[idx] = updater(order.items[idx]);
  persist();
}

export function setQty(id: string, qty: number) {
  const it = order.items.find(i => i.id === id);
  if (!it) return;
  it.qty = Math.max(1, Math.round(qty));
  persist();
}

export function removeItem(id: string) {
  order.items = order.items.filter(i => i.id !== id);
  persist();
}

export function clearOrder() {
  order = emptyOrder();
  persist();
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
