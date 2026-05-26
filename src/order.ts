// Заказ = массив позиций. Каждая позиция — снимок выборов пользователя
// + снимок рассчитанной цены в момент добавления.

import type { Category } from './model';
import type { ProfileColor, GlassColor, GlassType } from './catalog';
import type { HingeMode, HingeSide } from './state';
import type { PriceBreakdown } from './pricing';

/** Сериализуемая копия FacadeState (без методов) */
export interface FacadeConfig {
  width: number;
  height: number;
  profileColor: ProfileColor;
  glassColor:   GlassColor;
  glassType:    GlassType;
  tempered:     boolean;
  hingeMode:    HingeMode;
  hingeSide:    HingeSide;
  hingePositions: number[];
}

export interface OrderItem {
  /** Уникальный id строки заказа */
  id: string;
  /** Ссылка на модель в каталоге */
  modelRef: { category: Category; modelId: string };
  /** Снимок названия модели (на случай если модель удалят/переименуют) */
  modelName: string;
  /** Снимок конфигурации пользователя */
  config: FacadeConfig;
  /** Снимок расчёта цены в момент добавления (за 1 шт) */
  priceSnapshot: PriceBreakdown;
  /** Количество */
  qty: number;
  /** Время добавления */
  addedAt: string;
}

export interface Order {
  items: OrderItem[];
}

export function emptyOrder(): Order {
  return { items: [] };
}

export function orderTotal(order: Order): number {
  return order.items.reduce((s, i) => s + i.priceSnapshot.total * i.qty, 0);
}

export function orderItemCount(order: Order): number {
  return order.items.reduce((s, i) => s + i.qty, 0);
}
