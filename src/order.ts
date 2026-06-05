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
  /** Локальный id строки (генерится клиентом, остаётся на всю жизнь записи) */
  id: string;
  /** ID, выданный сервером после синхронизации. Заполняется при появлении бэка. */
  serverId?: string;
  /** Ссылка на модель в каталоге */
  modelRef: { category: Category; modelId: string };
  /** Снимок названия модели (на случай если модель удалят/переименуют) */
  modelName: string;
  /** Снимок конфигурации пользователя */
  config: FacadeConfig;
  /** Оценка цены (за 1 шт). Когда подключим сервер — он вернёт авторитетную;
   *  сейчас рассчитывается локально и используется только для UI. */
  priceSnapshot: PriceBreakdown;
  /** Количество */
  qty: number;
  /** Время добавления */
  addedAt: string;
}

/** Состояние заказа относительно бэка. Сейчас всегда 'draft' — сервера нет. */
export type OrderState = 'draft' | 'pending' | 'confirmed' | 'failed';

export interface Order {
  /** Локальный ID заказа-черновика. На сервере получит serverId. */
  clientId?: string;
  serverId?: string;
  state?: OrderState;
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
