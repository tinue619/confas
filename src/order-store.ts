// Прокси к корзине через единый API-адаптер. Старые consumer'ы (cart UI)
// продолжают ходить сюда без правок — сигнатуры не меняются, реализация
// под капотом теперь делегирует в `api.cart`.

import type { Order, OrderItem } from './order';
import { api } from './api';

export function getOrder(): Order {
  return api.cart.get();
}

export function subscribe(fn: () => void): () => void {
  return api.cart.subscribe(fn);
}

export function addItem(item: OrderItem) {
  api.cart.add(item);
}

export function updateItem(id: string, updater: (it: OrderItem) => OrderItem) {
  api.cart.update(id, updater);
}

export function setQty(id: string, qty: number) {
  api.cart.setQty(id, qty);
}

export function removeItem(id: string) {
  api.cart.remove(id);
}

export function clearOrder() {
  api.cart.clear();
}

export function newId(): string {
  return api.cart.newId();
}
