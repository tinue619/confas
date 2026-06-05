// Фасад «активного черновика» поверх api.orders.
//
// Конфигуратор всегда наполняет ровно один черновик — активный. Его id
// хранится здесь. Черновик создаётся лениво (при первой добавленной позиции),
// поэтому пустые черновики не плодятся. Старые consumer'ы (cart UI в app.ts)
// продолжают звать getOrder/addItem/… без правок.

import type { Order, OrderItem, OrderHeader } from './order';
import { emptyOrder } from './order';
import { api } from './api';

let activeId: string | null = null;

/** Начать новый заказ: сбрасываем активный черновик (создастся при 1-й позиции). */
export function beginNewDraft() {
  activeId = null;
}

/** Сделать активным существующий заказ-черновик (продолжить редактирование). */
export function setActive(id: string) {
  activeId = id;
}

export function getActiveId(): string | null {
  return activeId;
}

/** Активный черновик. Если его нет — отдаём транзиентный пустой (не персистим). */
export function getOrder(): Order {
  if (activeId) {
    const o = api.orders.get(activeId);
    if (o) return o;
    activeId = null;
  }
  return emptyOrder();
}

function ensureDraft(): string {
  if (!activeId || !api.orders.get(activeId)) {
    activeId = api.orders.createDraft().clientId!;
  }
  return activeId;
}

export function subscribe(fn: () => void): () => void {
  return api.orders.subscribe(fn);
}

export function addItem(item: OrderItem) {
  api.orders.addItem(ensureDraft(), item);
}

export function updateItem(id: string, updater: (it: OrderItem) => OrderItem) {
  if (activeId) api.orders.updateItem(activeId, id, updater);
}

export function setQty(id: string, qty: number) {
  if (activeId) api.orders.setQty(activeId, id, qty);
}

export function removeItem(id: string) {
  if (activeId) api.orders.removeItem(activeId, id);
}

/** Удалить активный черновик целиком (кнопка «Очистить»). */
export function clearOrder() {
  if (activeId) { api.orders.deleteOrder(activeId); activeId = null; }
}

/** Выкинуть активный черновик, если он пустой (при выходе из конфигуратора). */
export function discardIfEmpty() {
  if (!activeId) return;
  const o = api.orders.get(activeId);
  if (o && o.items.length === 0) { api.orders.deleteOrder(activeId); activeId = null; }
}

/** Оформить активный черновик. После — активный сбрасывается. */
export async function submitActive(header: OrderHeader): Promise<Order> {
  if (!activeId) throw new Error('Нет активного черновика');
  const result = await api.orders.submit(activeId, header);
  activeId = null;
  return result;
}

export function newId(): string {
  return api.orders.newId();
}
