// Long-press превью позиции заказа: тот же FacadeRenderer, что и в редакторе.
//
// Используется и в корзине (состав активного черновика), и в карточке
// отправленного заказа в кабинете.

import { FacadeState } from './state';
import { FacadeRenderer } from './canvas-render';
import { CATALOG } from './models-loader';
import type { OrderItem } from './order';
import { compactSpec, escapeHtml } from './ui-format';

/** Найти модель по modelRef. Возвращает null если в каталоге её больше нет
 *  (модель удалили) — превью без модели не отрисуется. */
function resolveModel(item: OrderItem) {
  const entry = CATALOG.find(e =>
    e.category === item.modelRef.category && e.id === item.modelRef.modelId);
  return entry?.model ?? null;
}

/** Показывает превью; возвращает функцию-закрывалку. */
export function showItemPreview(item: OrderItem, num: number): () => void {
  const model = resolveModel(item);
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  const card = document.createElement('div');
  card.className = 'preview-card';
  const specBits = compactSpec(item.config);
  card.innerHTML = `
    <div class="preview-header">
      <span class="preview-num">${num}.</span>
      <span class="preview-size">${item.config.width}×${item.config.height}</span>
      ${item.qty > 1 ? `<span class="preview-qty">×${item.qty}</span>` : ''}
    </div>
    <div class="preview-canvas-wrap">
      <canvas></canvas>
    </div>
    <div class="preview-spec">${escapeHtml(specBits || '—')}</div>`;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  if (model) {
    const canvas = card.querySelector('canvas') as HTMLCanvasElement;
    const tmpState = new FacadeState();
    Object.assign(tmpState, item.config, {
      hingePositions: [...item.config.hingePositions],
    });
    const renderer = new FacadeRenderer(canvas);
    renderer.setModel(model);
    renderer.setState(tmpState);
    renderer.onTap = null;
    requestAnimationFrame(() => renderer.redraw());
  }

  let closed = false;
  const close = () => { if (!closed) { closed = true; overlay.remove(); } };
  // Fallback: тап по затемнённому фону закрывает (на случай если pointerup потерялся)
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  return close;
}

/** Долгий тап на строке → превью, отпустил — скрыл.
 *  Закрытие — на реальный pointerup (а не pointercancel), окно слушаем в
 *  capture-фазе чтобы событие точно дошло. */
export function bindLongPress(row: HTMLElement, item: OrderItem, num: number) {
  let timer: number | null = null;
  let startX = 0, startY = 0;

  row.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement;
    if (t.closest('button, input')) return;
    const pid = e.pointerId;
    startX = e.clientX; startY = e.clientY;

    const earlyUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      window.removeEventListener('pointerup', earlyUp, true);
      window.removeEventListener('pointercancel', earlyUp, true);
    };
    window.addEventListener('pointerup', earlyUp, true);
    window.addEventListener('pointercancel', earlyUp, true);

    timer = window.setTimeout(() => {
      timer = null;
      window.removeEventListener('pointerup', earlyUp, true);
      window.removeEventListener('pointercancel', earlyUp, true);

      if ((navigator as any).vibrate) (navigator as any).vibrate(12);
      const closePreview = showItemPreview(item, num);

      const onAnyUp = () => {
        closePreview();
        window.removeEventListener('pointerup', onAnyUp, true);
        window.removeEventListener('touchend', onAnyUp, true);
        window.removeEventListener('mouseup', onAnyUp, true);
      };
      window.addEventListener('pointerup', onAnyUp, true);
      window.addEventListener('touchend', onAnyUp, true);
      window.addEventListener('mouseup', onAnyUp, true);
    }, 450);
  });

  row.addEventListener('pointermove', e => {
    if (timer === null) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
      clearTimeout(timer); timer = null;
    }
  });
}
