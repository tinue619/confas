// Главное приложение: шапка (логотип/цена/корзина), 2D canvas, переключатель
// инструментов и текущий инструмент снизу.

import './styles.css';
import { FacadeState, autoHingePositions, spreadHinges, sideLength,
         type HingeSide } from './state';
import { PROFILE_COLORS, GLASS_COLORS, GLASS_TYPES,
         type ProfileColor, type GlassColor, type GlassType } from './catalog';
import { CATALOG } from './models-loader';
import { calcPrice } from './pricing';
import * as store from './order-store';
import { orderItemCount, orderTotal, type FacadeConfig, type OrderItem } from './order';
import { FacadeRenderer, type Hit } from './canvas-render';
import { WheelPicker } from './wheel-picker';
import { Carousel } from './carousel';
import { openCheckoutSheet } from './checkout';
import { openCabinet, closeCabinet, setCabinetHandlers, openOrderDetails } from './cabinet';
import { setOpenSheet } from './ui-sheet';
import { fmtMoney, escapeHtml, compactSpec, facadeIcon } from './ui-format';
import { bindLongPress } from './item-preview';

const ICON = {
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.3 11.3a2 2 0 0 0 2 1.7h8.4a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v7M14 11v7"/></svg>`,
  mirror: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M8 7 4 12l4 5M16 7l4 5-4 5"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
};

export function mountApp(root: HTMLElement) {
  root.innerHTML = '';

  // Пока берём первую модель (категория facade), категории не выбираем
  const entry = CATALOG.find(e => e.category === 'facade') ?? CATALOG[0];
  if (!entry) {
    root.innerHTML = '<div style="padding:40px;color:#fff">Нет моделей в каталоге</div>';
    return;
  }
  const model = entry.model;
  const fs = new FacadeState();
  fs.width  = 600;
  fs.height = 716;

  // ── DOM скелет ─────────────────────────────────────────────────────────
  root.insertAdjacentHTML('beforeend', `
    <header>
      <div class="header-left">
        <button class="icon-btn" id="home-btn" aria-label="К заказам">
          <span class="icon-btn-glyph">${ICON.back}</span>
        </button>
        <div class="price-tag" id="price-tag">—</div>
      </div>
      <button class="add-cart-btn" id="add-fab">
        <span class="add-cart-icon">${ICON.cart}</span>
        <span>В заказ</span>
      </button>
      <button class="cart-btn" id="cart-btn">
        <span class="cart-total" id="cart-total">—</span>
        <span class="cart-icon">${ICON.cart}</span>
      </button>
    </header>
    <main>
      <div class="canvas-section">
        <canvas id="facade-canvas"></canvas>
      </div>
      <div class="tool-area" id="tool-area"></div>
    </main>
  `);

  const canvas = document.getElementById('facade-canvas') as HTMLCanvasElement;
  const toolArea = document.getElementById('tool-area') as HTMLDivElement;
  const priceTag = document.getElementById('price-tag') as HTMLElement;
  const cartBtn  = document.getElementById('cart-btn') as HTMLButtonElement;
  const cartTotal = document.getElementById('cart-total') as HTMLElement;
  const addFab  = document.getElementById('add-fab') as HTMLButtonElement;
  const homeBtn = document.getElementById('home-btn') as HTMLButtonElement;

  // ── Рендерер canvas ────────────────────────────────────────────────────
  const renderer = new FacadeRenderer(canvas);
  renderer.setModel(model);
  renderer.setState(fs);

  // ── Режим редактирования позиции корзины ─────────────────────────────
  // Полноэкранная шторка с редактором: туда «переезжают» canvas-section +
  // tool-area, шторка едет снизу. Кнопка «Готово» закрывает её обратно.
  let editingItemId: string | null = null;
  let editOverlay: HTMLElement | null = null;

  const enterEditMode = (id: string) => {
    const item = store.getOrder().items.find(i => i.id === id);
    if (!item) return;
    editingItemId = id;

    // Отдельное состояние для редактирования — основной fs не трогаем.
    const editFs = new FacadeState();
    editFs.width = item.config.width;
    editFs.height = item.config.height;
    editFs.profileColor = item.config.profileColor;
    editFs.glassColor = item.config.glassColor;
    editFs.glassType = item.config.glassType;
    editFs.tempered = item.config.tempered;
    editFs.hingeMode = item.config.hingeMode;
    editFs.hingeSide = item.config.hingeSide;
    editFs.hingePositions = [...item.config.hingePositions];

    const idx = store.getOrder().items.findIndex(i => i.id === id);
    const overlay = document.createElement('div');
    overlay.className = 'edit-overlay';
    overlay.innerHTML = `
      <div class="edit-header">
        <div class="edit-title">
          <span class="edit-num">${idx + 1}.</span>
          <span class="edit-size" id="edit-size">${editFs.width}×${editFs.height}</span>
        </div>
        <button class="edit-save" id="edit-save">✓ Готово</button>
      </div>
      <div class="edit-body">
        <div class="canvas-section">
          <canvas></canvas>
        </div>
        <div class="tool-area" id="edit-tool-area"></div>
      </div>`;
    document.body.appendChild(overlay);

    const editCanvas = overlay.querySelector('canvas') as HTMLCanvasElement;
    const editToolArea = overlay.querySelector('#edit-tool-area') as HTMLElement;
    const editSizeEl = overlay.querySelector('#edit-size') as HTMLElement;
    const editRenderer = new FacadeRenderer(editCanvas);
    editRenderer.setModel(model);
    editRenderer.setState(editFs);

    const editRefresh = () => {
      editRenderer.redraw();
      editSizeEl.textContent = `${editFs.width}×${editFs.height}`;
      const br = calcPrice(model, editFs);
      store.updateItem(id, it => ({
        ...it,
        config: {
          width: editFs.width, height: editFs.height,
          profileColor: editFs.profileColor, glassColor: editFs.glassColor,
          glassType: editFs.glassType, tempered: editFs.tempered,
          hingeMode: editFs.hingeMode, hingeSide: editFs.hingeSide,
          hingePositions: [...editFs.hingePositions],
        },
        priceSnapshot: br,
      }));
    };

    editRenderer.onTap = (hit: Hit) => handleCanvasTap(hit, editFs, model, editRefresh, editRenderer);
    mountHingesTool(editToolArea, editFs, model, editRefresh);

    editOverlay = overlay;
    (overlay.querySelector('#edit-save') as HTMLButtonElement).onclick = exitEditMode;
    requestAnimationFrame(() => {
      overlay.classList.add('edit-overlay--open');
      editRefresh();
    });
  };

  const exitEditMode = () => {
    if (!editOverlay) { editingItemId = null; return; }
    // Если внутри редактора была открыта шторка (размер/материал/петля) —
    // закрываем её вместе с оверлеем.
    activeSheetClose?.();
    const overlay = editOverlay;
    editOverlay = null;
    overlay.classList.remove('edit-overlay--open');
    setTimeout(() => { overlay.remove(); editingItemId = null; }, 300);
    // Возвращаемся в корзину, откуда зашли в редактирование позиции.
    openCart();
  };

  const refresh = () => {
    renderer.redraw();
    updatePrice();
  };
  const updatePrice = () => {
    const br = calcPrice(model, fs);
    const warn = br.missing.length > 0 ? '<span class="price-warn">⚠</span>' : '';
    priceTag.innerHTML = `${fmtMoney(br.total)}${warn}`;
  };
  const updateCart = () => {
    const order = store.getOrder();
    const n = orderItemCount(order);
    cartTotal.textContent = n > 0 ? fmtMoney(orderTotal(order)) : '0 ₸';
    // Бейдж
    cartBtn.querySelector('.cart-badge')?.remove();
    if (n > 0) {
      const b = document.createElement('span');
      b.className = 'cart-badge';
      b.textContent = String(n);
      cartBtn.appendChild(b);
    }
  };

  // Следим за высотой тулбара — резерв снизу у main строится через CSS max().
  const updateToolH = () => {
    const h = toolArea.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--tool-h', h + 'px');
  };
  new ResizeObserver(updateToolH).observe(toolArea);

  // ── Tap по canvas ──────────────────────────────────────────────────────
  renderer.onTap = (hit: Hit) => handleCanvasTap(hit, fs, model, refresh, renderer);

  // Внизу всегда инструмент петель. Материалы и размеры — через тапы по чертежу.
  const renderTool = () => {
    toolArea.innerHTML = '';
    mountHingesTool(toolArea, fs, model, refresh);
  };

  // ── Навигация: дом (кабинет) ↔ конфигуратор ──────────────────────────────
  // Конфигуратор всегда наполняет активный черновик. Возврат домой выкидывает
  // пустой черновик. «Оформить» → submit → возврат домой (+ опц. детали).
  const exitToCabinet = () => {
    store.discardIfEmpty();
    openCabinet();
  };
  homeBtn.onclick = exitToCabinet;

  const startCheckout = () => {
    openCheckoutSheet({
      onSubmitted: (order, openDetails) => {
        openCabinet();
        if (openDetails) openOrderDetails(order);
      },
    });
  };

  // Сброс «болванки» на чертеже к дефолту при входе в новый/другой заказ.
  const resetScratch = () => {
    const d = new FacadeState();
    d.width = 600; d.height = 716;
    fs.width = d.width; fs.height = d.height;
    fs.profileColor = d.profileColor;
    fs.glassColor = d.glassColor;
    fs.glassType = d.glassType;
    fs.tempered = d.tempered;
    fs.hingeMode = d.hingeMode;
    fs.hingeSide = d.hingeSide;
    fs.hingePositions = [...d.hingePositions];
  };
  const enterConfigurator = () => { resetScratch(); renderTool(); refresh(); updateCart(); };

  setCabinetHandlers({
    onNewOrder:  () => { store.beginNewDraft();  enterConfigurator(); },
    onOpenDraft: (id) => { store.setActive(id);  enterConfigurator(); },
  });

  // ── Состав заказа (бывш. корзина) ────────────────────────────────────────
  const openCart = () => openCartSheet(fs, model, refresh, enterEditMode, startCheckout);
  cartBtn.onclick = openCart;

  // Добавление текущего фасада в заказ (идентичные конфиги мёрджатся).
  addFab.onclick = () => {
    addCurrentToCart(fs, model, 1);
    addFab.classList.remove('add-fab--pop');
    void addFab.offsetWidth;
    addFab.classList.add('add-fab--pop');
    if ((navigator as any).vibrate) (navigator as any).vibrate(8);
  };

  store.subscribe(updateCart);
  renderTool();
  updateCart();
  // Первая отрисовка после layout
  requestAnimationFrame(() => refresh());
  window.addEventListener('resize', refresh);
  // Дом открыт по умолчанию (без анимации на старте). Если профиля нет —
  // покажет регистрацию.
  openCabinet({ animate: false });
}

// ─── Tap по canvas: петля → редактировать; пустое место по стороне → добавить ─

function handleCanvasTap(hit: Hit, fs: FacadeState, model: any, refresh: () => void, renderer: FacadeRenderer) {
  if (!hit) return;
  if (hit.kind === 'dim')     { openDimensionEditor(fs, model, hit.axis, refresh); return; }
  if (hit.kind === 'profile') { openProfileEditor(fs, refresh); return; }
  if (hit.kind === 'glass')   { openGlassEditor(fs, refresh); return; }
  if (hit.kind === 'hinge')   { openHingeEditor(fs, model, hit.index, refresh, renderer); return; }
}

function openHingeEditor(fs: FacadeState, model: any, index: number, refresh: () => void, renderer?: FacadeRenderer) {
  const sideLen = sideLength(fs);
  // Подписи зависят от стороны: для вертикальных рёбер — снизу/сверху,
  // для горизонтальных — слева/справа.
  const isVertical = fs.hingeSide === 'left' || fs.hingeSide === 'right';
  const labelFromStart = isVertical ? 'снизу' : 'слева';
  const labelFromEnd   = isVertical ? 'сверху' : 'справа';

  // Ограничения позиции:
  //  • минимум 60мм от любого края;
  //  • минимум 20мм между петлями (по соседям в массиве).
  const EDGE_MIN  = 60;
  const HINGE_GAP = 45;
  const editVal = fs.hingePositions[index];
  const others  = fs.hingePositions.filter((_, i) => i !== index).sort((a, b) => a - b);
  const below   = [...others].filter(p => p <= editVal).pop();
  const above   = others.find(p => p > editVal);
  const minBound = Math.max(EDGE_MIN, (below ?? -Infinity) + HINGE_GAP);
  const maxBound = Math.min(sideLen - EDGE_MIN, (above ?? Infinity) - HINGE_GAP);

  // Магнитные точки = «стандартная» расстановка для ТЕКУЩЕГО количества петель
  // (не из interval-таблицы модели — там может быть другое число).
  const endOffset = model.hinges?.endOffset ?? 100;
  const standard  = spreadHinges(fs.hingePositions.length, sideLen, endOffset);
  const snapPoints = standard.filter(p => p >= minBound && p <= maxBound);

  openSheet(`Петля #${index + 1}`, (body, close) => {
    // Подсветка ставится после закрытия предыдущей шторки (та сбрасывает на null)
    renderer?.setEditingHinge(index);
    let currentValue = editVal;

    new WheelPicker({
      parent: body,
      name: labelFromStart, unit: 'мм',
      min: minBound, max: maxBound, value: currentValue,
      // Расстояния показываем до СОСЕДНИХ петель. Если соседа нет — до края.
      valueOffset: below ?? 0,
      mirrorMax: above ?? sideLen, mirrorLabel: labelFromEnd,
      snapPoints, snapTolerance: 4,
      // Value-readout всегда уходит в левую колонку:
      //   • для горизонтальных сторон → «слева» слева, «справа» справа
      //   • для вертикальных          → «снизу» слева, «сверху» справа
      valueOnLeft: true,
      onChange: v => {
        currentValue = v;
        fs.hingePositions[index] = v;
        refresh();
      },
    });

    const btns = document.createElement('div');
    btns.className = 'btn-row';

    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.innerHTML = `<span class="btn-icon">${ICON.trash}</span>Удалить`;
    del.onclick = () => {
      const newCount = Math.max(0, fs.hingePositions.length - 1);
      const endOffset = model.hinges?.endOffset ?? 100;
      fs.hingePositions = spreadHinges(newCount, sideLength(fs), endOffset);
      close();
      refresh();
    };

    const ok = document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.textContent = 'Готово';
    ok.onclick = () => close();

    btns.append(del, ok);
    body.appendChild(btns);
  }, { id: `hinge-${index}`, dim: false, onClose: () => renderer?.setEditingHinge(null) });
  // Suppress unused
  void model;
}

// ─── Инструменты ──────────────────────────────────────────────────────────────

// При изменении размера переразлагаем петли, если сторона, на которой они стоят,
// зависит от изменившегося измерения.
function respreadHinges(fs: FacadeState, model: any, affectsAxis: 'h' | 'v') {
  if (!model.hinges || fs.hingePositions.length === 0) return;
  const isVertical = fs.hingeSide === 'left' || fs.hingeSide === 'right';
  if (affectsAxis === 'h' && !isVertical) {
    fs.hingePositions = spreadHinges(fs.hingePositions.length, fs.width, model.hinges.endOffset ?? 100);
  } else if (affectsAxis === 'v' && isVertical) {
    fs.hingePositions = spreadHinges(fs.hingePositions.length, fs.height, model.hinges.endOffset ?? 100);
  }
}

function openDimensionEditor(fs: FacadeState, model: any, axis: 'width' | 'height', refresh: () => void) {
  const isWidth = axis === 'width';
  openSheet(isWidth ? 'Ширина' : 'Высота', (body, _close) => {
    new WheelPicker({
      parent: body,
      axis: isWidth ? 'X' : 'Y',
      name: isWidth ? 'Ширина' : 'Высота',
      unit: 'мм',
      min: 250,
      max: isWidth ? 2250 : 3210,
      value: isWidth ? fs.width : fs.height,
      onChange: v => {
        if (isWidth) { fs.width = v; respreadHinges(fs, model, 'h'); }
        else        { fs.height = v; respreadHinges(fs, model, 'v'); }
        refresh();
      },
    });
  }, { id: `dim-${axis}`, dim: false });
}

function openProfileEditor(fs: FacadeState, refresh: () => void) {
  openSheet('Профиль', (body, _close) => {
    new Carousel<ProfileColor>({
      parent: body, name: 'Цвет профиля',
      items: Object.entries(PROFILE_COLORS).map(([k, v]) => ({
        value: k as ProfileColor, label: v.name, swatch: v.hex,
      })),
      value: fs.profileColor,
      onChange: v => { fs.profileColor = v; refresh(); },
    });
  }, { id: 'profile', dim: false });
}

function openGlassEditor(fs: FacadeState, refresh: () => void) {
  openSheet('Стекло', (body, _close) => {
    new Carousel<GlassColor>({
      parent: body, name: 'Цвет',
      items: Object.entries(GLASS_COLORS).map(([k, v]) => ({
        value: k as GlassColor, label: v.name, swatch: v.hex,
      })),
      value: fs.glassColor,
      onChange: v => { fs.glassColor = v; refresh(); },
    });
    new Carousel<GlassType>({
      parent: body, name: 'Тип',
      items: Object.entries(GLASS_TYPES).map(([k, v]) => ({
        value: k as GlassType, label: v.name,
      })),
      value: fs.glassType,
      onChange: v => { fs.glassType = v; refresh(); },
    });
    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.innerHTML = `<label>Закалённое</label><div class="toggle ${fs.tempered ? 'on' : ''}"></div>`;
    const toggle = row.querySelector('.toggle') as HTMLElement;
    toggle.onclick = () => {
      fs.tempered = !fs.tempered;
      toggle.classList.toggle('on', fs.tempered);
      refresh();
    };
    body.appendChild(row);
  }, { id: 'glass', dim: false });
}

function mountHingesTool(area: HTMLElement, fs: FacadeState, model: any, refresh: () => void) {
  toolHeader(area, 'Петли', 'Тап по петле — править');

  if (!model.drilling || !model.hinges) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:14px;color:#7a7670;font-size:12px';
    note.textContent = 'У этой модели не задана присадка/петли.';
    area.appendChild(note);
    return;
  }

  // Авто-заливка дефолтных позиций — только при первом входе (mode='none').
  if (fs.hingeMode === 'none') {
    fs.hingeMode = 'holes+hinges';
    if (fs.hingePositions.length === 0) {
      fs.hingePositions = autoHingePositions(model.hinges, sideLength(fs));
    }
  }

  const remount = () => {
    area.innerHTML = '';
    mountHingesTool(area, fs, model, refresh);
  };

  const sideLen = sideLength(fs);
  const endOffset = model.hinges?.endOffset ?? 100;
  const count = fs.hingePositions.length;
  const maxCount = Math.max(1, Math.floor((sideLen - 120) / 45) + 1);
  const setCount = (n: number) => {
    fs.hingePositions = spreadHinges(Math.max(0, Math.min(maxCount, n)), sideLen, endOffset);
    refresh();
    remount();
  };

  // Единая строка: чипы стороны (Лево/Верх) + зеркало + степпер количества.
  // Канонная сторона — left/top; зеркало переворачивает на парную right/bottom.
  const row = document.createElement('div');
  row.className = 'hinges-row';

  const isVertical = fs.hingeSide === 'left' || fs.hingeSide === 'right';
  const flipped = fs.hingeSide === 'right' || fs.hingeSide === 'bottom';

  const sides = document.createElement('div');
  sides.className = 'side-chips';
  const sideOptions: Array<['left' | 'top', string]> = [['left', 'Верт.'], ['top', 'Гор.']];
  for (const [base, label] of sideOptions) {
    const axisActive = base === 'left' ? isVertical : !isVertical;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'side-chip' + (axisActive ? ' active' : '');
    b.textContent = label;
    b.onclick = () => {
      fs.hingeSide = base; // канонная (не зеркальная) ориентация
      fs.hingePositions = autoHingePositions(model.hinges, sideLength(fs));
      refresh();
      remount();
    };
    sides.appendChild(b);
  }

  // Кнопка зеркала: переворачивает на парную сторону (left↔right, top↔bottom).
  const mirror = document.createElement('button');
  mirror.type = 'button';
  mirror.className = 'mirror-btn' + (flipped ? ' active' : '');
  mirror.innerHTML = `<span class="mirror-icon">${ICON.mirror}</span>`;
  mirror.title = 'Зеркально';
  mirror.disabled = count === 0;
  mirror.onclick = () => {
    const flip: Record<HingeSide, HingeSide> = {
      left: 'right', right: 'left', top: 'bottom', bottom: 'top',
    };
    fs.hingeSide = flip[fs.hingeSide];
    refresh();
    remount();
  };

  const stepper = document.createElement('div');
  stepper.className = 'stepper';
  stepper.innerHTML = `
    <button class="stepper-btn" data-act="dec" ${count <= 0 ? 'disabled' : ''}>−</button>
    <span class="stepper-val">${count}</span>
    <button class="stepper-btn" data-act="inc" ${count >= maxCount ? 'disabled' : ''}>+</button>`;
  (stepper.querySelector('[data-act="dec"]') as HTMLButtonElement).onclick = () => setCount(count - 1);
  (stepper.querySelector('[data-act="inc"]') as HTMLButtonElement).onclick = () => setCount(count + 1);

  row.append(sides, mirror, stepper);
  area.appendChild(row);
}

function toolHeader(area: HTMLElement, title: string, hint = '') {
  const h = document.createElement('div');
  h.className = 'tool-header';
  h.innerHTML = `<div class="tool-title">${title}</div><div class="tool-hint">${hint}</div>`;
  area.appendChild(h);
}

// ─── Корзина (шторка) ─────────────────────────────────────────────────────────

function sameConfig(a: FacadeConfig, b: FacadeConfig): boolean {
  if (a.width !== b.width) return false;
  if (a.height !== b.height) return false;
  if (a.profileColor !== b.profileColor) return false;
  if (a.glassColor !== b.glassColor) return false;
  if (a.glassType !== b.glassType) return false;
  if (a.tempered !== b.tempered) return false;
  if (a.hingeMode !== b.hingeMode) return false;
  if (a.hingeSide !== b.hingeSide) return false;
  if (a.hingePositions.length !== b.hingePositions.length) return false;
  // Положения петель сравниваем как отсортированные мультимножества.
  const sa = [...a.hingePositions].sort((x, y) => x - y);
  const sb = [...b.hingePositions].sort((x, y) => x - y);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function addCurrentToCart(fs: FacadeState, model: any, count = 1) {
  const br = calcPrice(model, fs);
  const cfg: FacadeConfig = {
    width: fs.width, height: fs.height,
    profileColor: fs.profileColor, glassColor: fs.glassColor, glassType: fs.glassType,
    tempered: fs.tempered, hingeMode: fs.hingeMode, hingeSide: fs.hingeSide,
    hingePositions: [...fs.hingePositions],
  };
  // Идентичный фасад уже есть — увеличиваем количество.
  const existing = store.getOrder().items.find(it => sameConfig(it.config, cfg));
  if (existing) {
    store.setQty(existing.id, existing.qty + count);
    return;
  }
  store.addItem({
    id: store.newId(),
    modelRef: { category: 'facade', modelId: 'wide' },
    modelName: model.name,
    config: cfg, priceSnapshot: br, qty: count,
    addedAt: new Date().toISOString(),
  });
}

function openCartSheet(fs: FacadeState, model: any, refresh: () => void, onEdit: (id: string) => void, onCheckout: () => void) {
  void fs; void refresh;
  openSheet('Состав заказа', (body, close) => {
    const renderInside = () => {
      body.innerHTML = '';
      fillCart(body, () => renderInside(), close, model, (id) => { onEdit(id); close(); }, onCheckout);
    };
    renderInside();
  }, { id: 'cart' });
}

function fillCart(body: HTMLElement, rerender: () => void, _close: () => void, model: any, onEdit: (id: string) => void, onCheckout: () => void) {
  const order = store.getOrder();
  if (order.items.length === 0) {
    const e = document.createElement('div');
    e.className = 'cart-empty';
    e.innerHTML = `<div class="cart-empty-icon">${ICON.cart}</div>Заказ пуст. Добавьте фасады кнопкой «В заказ».`;
    body.appendChild(e);
    return;
  }

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];
    const c = item.config;
    const specs = compactSpec(c);
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <span class="cart-row-num">${i + 1}.</span>
      <span class="cart-row-size">${c.width}×${c.height}</span>
      ${facadeIcon(c, item.id)}
      <span class="cart-row-spec">${escapeHtml(specs)}</span>
      <div class="cart-row-qty">
        <button data-act="dec">−</button>
        <span class="val">${item.qty}</span>
        <button data-act="inc">+</button>
      </div>
      <span class="cart-row-total">${fmtMoney(item.priceSnapshot.total * item.qty)}</span>
      <button class="cart-row-del" aria-label="Удалить">×</button>`;
    (row.querySelector('[data-act="dec"]') as HTMLButtonElement).onclick = () => {
      store.setQty(item.id, item.qty - 1); rerender();
    };
    (row.querySelector('[data-act="inc"]') as HTMLButtonElement).onclick = () => {
      store.setQty(item.id, item.qty + 1); rerender();
    };
    (row.querySelector('.cart-row-del') as HTMLButtonElement).onclick = () => {
      store.removeItem(item.id); rerender();
    };
    // Тап по строке (вне интерактивных детей) — редактировать позицию
    row.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (t.closest('button, input')) return;
      onEdit(item.id);
    });
    bindLongPress(row, item, i + 1);
    body.appendChild(row);
  }

  const footer = document.createElement('div');
  footer.className = 'cart-footer';
  footer.innerHTML = `
    <div class="cart-total">
      <span class="cart-total-label">Итого по заказу</span>
      <span class="cart-total-value">${fmtMoney(orderTotal(order))}</span>
    </div>`;
  const right = document.createElement('div');
  right.className = 'btn-row';
  const clear = document.createElement('button');
  clear.className = 'btn btn-danger';
  clear.textContent = 'Очистить';
  clear.onclick = () => { if (confirm('Удалить все позиции?')) { store.clearOrder(); rerender(); } };
  const checkout = document.createElement('button');
  checkout.className = 'btn btn-primary';
  checkout.textContent = 'Оформить';
  checkout.onclick = () => onCheckout();
  right.append(clear, checkout);
  footer.appendChild(right);
  body.appendChild(footer);
}


// ─── Bottom sheet helper ──────────────────────────────────────────────────────

interface OpenSheetOpts { id?: string; dim?: boolean; onClose?: () => void }
let activeSheetClose: (() => void) | null = null;
let activeSheetId: string | null = null;
// Регистрируем шторку для внешних модулей (checkout и т.д.).
setOpenSheet(openSheet);
function openSheet(title: string, render: (body: HTMLElement, close: () => void) => void, opts: OpenSheetOpts = {}) {
  // Та же шторка уже открыта — игнорируем повторный тап
  if (opts.id && activeSheetId === opts.id) return;
  const switching = activeSheetClose !== null;
  // Закрываем предыдущую шторку без анимации — чтобы не дублировались
  activeSheetClose?.();
  activeSheetId = opts.id ?? null;
  const dim = opts.dim ?? true;
  const onClose = opts.onClose;
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay' + (dim ? '' : ' sheet-overlay--nodim');
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="sheet-drag">
      <div class="sheet-handle"><span class="sheet-grip"></span></div>
      <div class="sheet-header">${title}</div>
    </div>
    <div class="sheet-body"></div>`;
  const body = sheet.querySelector('.sheet-body') as HTMLElement;
  document.body.append(overlay, sheet);

  void switching;
  const updateSheetH = () => {
    const h = sheet.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--sheet-h', h + 'px');
  };
  const sheetRo = new ResizeObserver(updateSheetH);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (activeSheetClose === close) { activeSheetClose = null; activeSheetId = null; }
    sheetRo.disconnect();
    // Снимаем padding одновременно со стартом slide-down шторки — canvas
    // расширяется синхронно (CSS transition .25s на padding-bottom).
    // Шторка имеет z-index выше канваса, поэтому визуально «накрывает» рост.
    if (activeSheetClose === null) {
      document.documentElement.style.removeProperty('--sheet-h');
    }
    overlay.classList.remove('sheet-overlay--open');
    sheet.classList.remove('sheet--open');
    sheet.style.transform = '';
    setTimeout(() => {
      overlay.remove();
      sheet.remove();
    }, 250);
    onClose?.();
  };
  activeSheetClose = close;
  render(body, close);
  requestAnimationFrame(() => {
    overlay.classList.add('sheet-overlay--open');
    sheet.classList.add('sheet--open');
    updateSheetH();
    sheetRo.observe(sheet);
  });
  // pointerdown, а не click — иначе click от исходного тапа (открывшего шторку)
  // приходит уже на overlay и тут же её закрывает.
  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) close();
  });

  // Drag-to-dismiss (на ручке и заголовке)
  const dragZone = sheet.querySelector('.sheet-drag') as HTMLElement;
  let startY = 0, dy = 0, dragging = false;
  dragZone.addEventListener('pointerdown', e => {
    dragging = true; startY = e.clientY; dy = 0;
    sheet.style.transition = 'none';
    dragZone.setPointerCapture(e.pointerId);
  });
  dragZone.addEventListener('pointermove', e => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    if (dy > 80) close();
    else sheet.style.transform = '';
  };
  dragZone.addEventListener('pointerup', onUp);
  dragZone.addEventListener('pointercancel', onUp);
}

