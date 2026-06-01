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

const ICON = {
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.3 11.3a2 2 0 0 0 2 1.7h8.4a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v7M14 11v7"/></svg>`,
  sun:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
};

const THEME_KEY = 'facade-theme';
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
}
initTheme();

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
      <div class="price-tag" id="price-tag">—</div>
      <button class="theme-btn" id="theme-btn" aria-label="Сменить тему"></button>
      <button class="cart-btn" id="cart-btn">
        <span class="cart-icon">${ICON.cart}</span>
        <span class="cart-total" id="cart-total">—</span>
      </button>
    </header>
    <main>
      <div class="canvas-section">
        <canvas id="facade-canvas"></canvas>
        <div class="add-fab" id="add-fab">
          <button class="add-fab-step" data-act="dec" aria-label="меньше">−</button>
          <span class="add-fab-qty" id="add-fab-qty">1</span>
          <button class="add-fab-step" data-act="inc" aria-label="больше">+</button>
          <button class="add-fab-go" id="add-fab-go" aria-label="Добавить в корзину">
            <span class="add-fab-cart">${ICON.cart}</span>
          </button>
        </div>
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
  const themeBtn = document.getElementById('theme-btn') as HTMLButtonElement;

  // Переключатель темы
  const updateThemeBtn = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    themeBtn.innerHTML = isLight ? ICON.moon : ICON.sun;
  };
  updateThemeBtn();
  themeBtn.onclick = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeBtn();
    refresh();
  };

  // ── Рендерер canvas ────────────────────────────────────────────────────
  const renderer = new FacadeRenderer(canvas);
  renderer.setModel(model);
  renderer.setState(fs);

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

  // ── Tap по canvas ──────────────────────────────────────────────────────
  renderer.onTap = (hit: Hit) => handleCanvasTap(hit, fs, model, refresh, renderer);

  // Внизу всегда инструмент петель. Материалы и размеры — через тапы по чертежу.
  const renderTool = () => {
    toolArea.innerHTML = '';
    mountHingesTool(toolArea, fs, model, refresh);
  };

  // ── Корзина ────────────────────────────────────────────────────────────
  cartBtn.onclick = () => openCartSheet(fs, model, refresh);

  // Степпер количества внутри FAB + кнопка «добавить N штук»
  const fabQtyEl = document.getElementById('add-fab-qty') as HTMLElement;
  const fabGoEl  = document.getElementById('add-fab-go')  as HTMLButtonElement;
  let fabQty = 1;
  const setFabQty = (n: number) => {
    fabQty = Math.max(1, Math.min(99, n));
    fabQtyEl.textContent = String(fabQty);
  };
  addFab.querySelectorAll<HTMLButtonElement>('.add-fab-step').forEach(b => {
    b.onclick = () => setFabQty(fabQty + (b.dataset.act === 'inc' ? 1 : -1));
  });
  fabGoEl.onclick = () => {
    addCurrentToCart(fs, model, fabQty);
    // Лёгкая обратная связь — pop-анимация и вибрация
    addFab.classList.remove('add-fab--pop');
    void addFab.offsetWidth;
    addFab.classList.add('add-fab--pop');
    if ((navigator as any).vibrate) (navigator as any).vibrate(8);
    setFabQty(1);
  };

  store.subscribe(updateCart);
  renderTool();
  updateCart();
  // Первая отрисовка после layout
  requestAnimationFrame(() => refresh());
  window.addEventListener('resize', refresh);
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

  // Единая строка: 4 чипа сторон + степпер количества
  const row = document.createElement('div');
  row.className = 'hinges-row';

  const sides = document.createElement('div');
  sides.className = 'side-chips';
  const sideOptions: Array<[HingeSide, string]> = [
    ['left', 'Лево'], ['right', 'Право'], ['top', 'Верх'], ['bottom', 'Низ'],
  ];
  for (const [s, label] of sideOptions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'side-chip' + (s === fs.hingeSide ? ' active' : '');
    b.textContent = label;
    b.onclick = () => {
      fs.hingeSide = s;
      fs.hingePositions = autoHingePositions(model.hinges, sideLength(fs));
      refresh();
      remount();
    };
    sides.appendChild(b);
  }

  const stepper = document.createElement('div');
  stepper.className = 'stepper';
  stepper.innerHTML = `
    <button class="stepper-btn" data-act="dec" ${count <= 0 ? 'disabled' : ''}>−</button>
    <span class="stepper-val">${count}</span>
    <button class="stepper-btn" data-act="inc" ${count >= maxCount ? 'disabled' : ''}>+</button>`;
  (stepper.querySelector('[data-act="dec"]') as HTMLButtonElement).onclick = () => setCount(count - 1);
  (stepper.querySelector('[data-act="inc"]') as HTMLButtonElement).onclick = () => setCount(count + 1);

  row.append(sides, stepper);
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

function openCartSheet(fs: FacadeState, model: any, refresh: () => void) {
  void fs; void model;
  openSheet('Корзина', (body, close) => {
    const renderInside = () => {
      body.innerHTML = '';
      fillCart(body, () => renderInside(), close);
    };
    renderInside();
  }, { id: 'cart' });
}

function fillCart(body: HTMLElement, rerender: () => void, _close: () => void) {
  const order = store.getOrder();
  if (order.items.length === 0) {
    const e = document.createElement('div');
    e.className = 'cart-empty';
    e.innerHTML = `<div class="cart-empty-icon">${ICON.cart}</div>В корзине пусто`;
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
    bindLongPress(row, item);
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
  checkout.onclick = () => alert('Оформление: пока заглушка');
  right.append(clear, checkout);
  footer.appendChild(right);
  body.appendChild(footer);
}

/** Дополнительная инфа справа от пиктограммы: закалка + петли */
function compactSpec(c: FacadeConfig): string {
  const parts: string[] = [];
  if (c.tempered) parts.push('закал.');
  if (c.hingeMode !== 'none' && c.hingePositions.length > 0) {
    const arrow = { left: '←', right: '→', top: '↑', bottom: '↓' }[c.hingeSide];
    parts.push(`петли${arrow}${c.hingePositions.length}`);
  }
  return parts.join(' · ');
}

/** Большой SVG-эскиз фасада для long-press превью: рама, стекло, петли, размеры */
function facadePreviewSVG(c: FacadeConfig): string {
  const FRAME = 44, GLASS_M = 4;
  // Подгоняем под ~260×340 с сохранением пропорций
  const maxW = 260, maxH = 340;
  const ar = c.width / c.height;
  const maxAr = maxW / maxH;
  const dispW = ar > maxAr ? maxW : maxH * ar;
  const dispH = ar > maxAr ? maxW / ar : maxH;
  const s = dispW / c.width;
  const fpx = FRAME * s;
  const gpx = GLASS_M * s;

  const profileHex = PROFILE_COLORS[c.profileColor]?.hex ?? '#888';
  const glassHex = GLASS_COLORS[c.glassColor]?.hex ?? '#c4d8de';
  const matte = c.glassType === 'matte';
  const textured = c.glassType === 'textured';
  const rgba = (hex: string, a: number) => {
    const m = hex.replace('#', '');
    return `rgba(${parseInt(m.slice(0,2),16)},${parseInt(m.slice(2,4),16)},${parseInt(m.slice(4,6),16)},${a})`;
  };

  const padX = 24, padTop = 14, padBottom = 28;
  const svgW = dispW + padX * 2;
  const svgH = dispH + padTop + padBottom;
  const rx = padX, ry = padTop;

  // Стекло: подложка тёмная + заливка/рифление
  let glassLayer: string;
  if (textured) {
    const pid = `prv-tx-${Math.random().toString(36).slice(2, 8)}`;
    const stride = Math.max(3, 3 * s);
    glassLayer = `
      <defs>
        <pattern id="${pid}" width="${stride}" height="${dispH - gpx * 2}" patternUnits="userSpaceOnUse">
          <rect width="${stride}" height="${dispH - gpx * 2}" fill="${rgba(glassHex, 0.4)}"/>
          <rect width="${stride * 0.45}" height="${dispH - gpx * 2}" fill="${rgba(glassHex, 0.75)}"/>
        </pattern>
      </defs>
      <rect x="${rx + gpx}" y="${ry + gpx}" width="${dispW - gpx*2}" height="${dispH - gpx*2}" fill="#0d0c0b"/>
      <rect x="${rx + gpx}" y="${ry + gpx}" width="${dispW - gpx*2}" height="${dispH - gpx*2}" fill="url(#${pid})"/>`;
  } else {
    glassLayer = `
      <rect x="${rx + gpx}" y="${ry + gpx}" width="${dispW - gpx*2}" height="${dispH - gpx*2}" fill="#0d0c0b"/>
      <rect x="${rx + gpx}" y="${ry + gpx}" width="${dispW - gpx*2}" height="${dispH - gpx*2}" fill="${rgba(glassHex, matte ? 0.7 : 0.4)}"/>`;
  }

  // Рама: 4 трапеции с 45° запилами
  const outer = [[rx,ry],[rx+dispW,ry],[rx+dispW,ry+dispH],[rx,ry+dispH]];
  const inner = [
    [rx+fpx,ry+fpx],[rx+dispW-fpx,ry+fpx],
    [rx+dispW-fpx,ry+dispH-fpx],[rx+fpx,ry+dispH-fpx],
  ];
  let framePaths = '';
  for (let i = 0; i < 4; i++) {
    const j = (i+1) % 4;
    framePaths += `<polygon points="${outer[i][0]},${outer[i][1]} ${outer[j][0]},${outer[j][1]} ${inner[j][0]},${inner[j][1]} ${inner[i][0]},${inner[i][1]}" fill="${profileHex}"/>`;
  }
  // Тонкие контуры рамы + диагонали запилов
  let frameStrokes = `<rect x="${rx}" y="${ry}" width="${dispW}" height="${dispH}" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="0.6"/>`;
  frameStrokes += `<rect x="${rx+fpx}" y="${ry+fpx}" width="${dispW-fpx*2}" height="${dispH-fpx*2}" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="0.6"/>`;
  for (let i = 0; i < 4; i++) {
    frameStrokes += `<line x1="${outer[i][0]}" y1="${outer[i][1]}" x2="${inner[i][0]}" y2="${inner[i][1]}" stroke="rgba(0,0,0,0.45)" stroke-width="0.6"/>`;
  }

  // Петли
  let hingeDots = '';
  if (c.hingeMode !== 'none' && c.hingePositions.length > 0) {
    const edgeOff = 12; // px от наружного края, где «сидят» петли
    for (const pos of c.hingePositions) {
      let cx_ = 0, cy_ = 0;
      switch (c.hingeSide) {
        case 'left':   cx_ = rx + edgeOff;          cy_ = ry + dispH - pos * s; break;
        case 'right':  cx_ = rx + dispW - edgeOff;  cy_ = ry + dispH - pos * s; break;
        case 'top':    cx_ = rx + pos * s;          cy_ = ry + edgeOff;         break;
        case 'bottom': cx_ = rx + pos * s;          cy_ = ry + dispH - edgeOff; break;
      }
      hingeDots += `<circle cx="${cx_}" cy="${cy_}" r="5" fill="#0d0c0b" stroke="#c8a96e" stroke-width="1.4"/>`;
      hingeDots += `<line x1="${cx_-2}" y1="${cy_}" x2="${cx_+2}" y2="${cy_}" stroke="#c8a96e" stroke-width="0.8"/>`;
      hingeDots += `<line x1="${cx_}" y1="${cy_-2}" x2="${cx_}" y2="${cy_+2}" stroke="#c8a96e" stroke-width="0.8"/>`;
    }
  }

  // Размеры (под и справа)
  const widthLabel = `<text x="${rx + dispW/2}" y="${ry + dispH + 18}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="11" fill="#7a7670">${c.width} мм</text>`;
  const heightLabel = `<text x="${rx + dispW + 14}" y="${ry + dispH/2}" font-family="'JetBrains Mono', monospace" font-size="11" fill="#7a7670" transform="rotate(-90, ${rx + dispW + 14}, ${ry + dispH/2})" text-anchor="middle">${c.height} мм</text>`;

  return `<svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" class="preview-svg">
    ${glassLayer}
    ${framePaths}
    ${frameStrokes}
    ${hingeDots}
    ${widthLabel}
    ${heightLabel}
  </svg>`;
}

function showCartPreview(item: OrderItem) {
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  const card = document.createElement('div');
  card.className = 'preview-card';
  const specBits = compactSpec(item.config);
  card.innerHTML = `
    <div class="preview-header">
      <span class="preview-num">№ ${item.qty > 1 ? `<small>(×${item.qty})</small>` : ''}</span>
      <span class="preview-size">${item.config.width}×${item.config.height}</span>
    </div>
    ${facadePreviewSVG(item.config)}
    <div class="preview-spec">${escapeHtml(specBits || '—')}</div>`;
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  // Закрытие при тапе вне карточки и по кнопке Escape
  const close = () => overlay.remove();
  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
}

/** Привязывает long-press → showCartPreview к элементу строки */
function bindLongPress(row: HTMLElement, item: OrderItem) {
  let timer: number | null = null;
  let startX = 0, startY = 0;
  const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  row.addEventListener('pointerdown', e => {
    // Игнорируем нажатия на интерактивные дочерние элементы (кнопки/инпуты)
    const t = e.target as HTMLElement;
    if (t.closest('button, input')) return;
    startX = e.clientX; startY = e.clientY;
    timer = window.setTimeout(() => {
      timer = null;
      if ((navigator as any).vibrate) (navigator as any).vibrate(12);
      showCartPreview(item);
    }, 450);
  });
  row.addEventListener('pointermove', e => {
    if (timer === null) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) cancel();
  });
  row.addEventListener('pointerup', cancel);
  row.addEventListener('pointercancel', cancel);
  row.addEventListener('pointerleave', cancel);
}

/** SVG-пиктограмма фасада: рама цветом профиля, стекло цветом + текстура */
function facadeIcon(c: FacadeConfig, uid: string): string {
  const profileHex = PROFILE_COLORS[c.profileColor]?.hex ?? '#888';
  const glassHex = GLASS_COLORS[c.glassColor]?.hex ?? '#c4d8de';
  const matte = c.glassType === 'matte';
  const textured = c.glassType === 'textured';
  const W = 20, H = 26, fw = 2.5;
  const ix = fw, iy = fw, iw = W - 2 * fw, ih = H - 2 * fw;
  const rgba = (hex: string, a: number) => {
    const m = hex.replace('#', '');
    return `rgba(${parseInt(m.slice(0,2),16)},${parseInt(m.slice(2,4),16)},${parseInt(m.slice(4,6),16)},${a})`;
  };
  const glassAlpha = matte ? 0.7 : 0.4;
  let glassLayer: string;
  if (textured) {
    const pid = `tx-${uid}`;
    glassLayer = `
      <defs>
        <pattern id="${pid}" width="2.2" height="${ih}" patternUnits="userSpaceOnUse">
          <rect width="2.2" height="${ih}" fill="${rgba(glassHex, 0.4)}"/>
          <rect width="1" height="${ih}" fill="${rgba(glassHex, 0.75)}"/>
        </pattern>
      </defs>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="#0d0c0b"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="url(#${pid})"/>`;
  } else {
    glassLayer = `
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="#0d0c0b"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="${rgba(glassHex, glassAlpha)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="cart-facade-icon" aria-hidden="true">
    <rect width="${W}" height="${H}" fill="${profileHex}"/>
    ${glassLayer}
    <rect x="0.5" y="0.5" width="${W-1}" height="${H-1}" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
  </svg>`;
}

// ─── Bottom sheet helper ──────────────────────────────────────────────────────

interface OpenSheetOpts { id?: string; dim?: boolean; onClose?: () => void }
let activeSheetClose: (() => void) | null = null;
let activeSheetId: string | null = null;
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

  // Для плавной анимации запоминаем высоту tool-area — это «безопасный» padding,
  // при котором canvas не меняет размер ровно в момент скрытия tool-area.
  const mainEl = document.querySelector('main') as HTMLElement;
  const toolEl = document.getElementById('tool-area') as HTMLElement | null;
  const toolH = !switching && toolEl ? toolEl.getBoundingClientRect().height : 0;

  if (!switching) {
    // Мгновенно ставим padding = высоте tool-area + скрываем tool-area.
    // Canvas сохраняет тот же размер — нет рывка.
    mainEl.style.transition = 'none';
    document.documentElement.style.setProperty('--sheet-h', toolH + 'px');
    document.body.classList.add('has-sheet');
    void mainEl.offsetHeight; // force reflow
    mainEl.style.transition = '';
  }

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
    overlay.classList.remove('sheet-overlay--open');
    sheet.classList.remove('sheet--open');
    sheet.style.transform = '';
    // На закрытии возвращаем padding к высоте tool-area плавно — canvas
    // расширяется параллельно с уезжанием шторки.
    if (toolH > 0) {
      document.documentElement.style.setProperty('--sheet-h', toolH + 'px');
    }
    setTimeout(() => {
      if (activeSheetClose === null) {
        // Анимация завершена — мгновенно показываем tool-area и сбрасываем padding.
        // Canvas не меняет размер (padding=toolH без tool-area == padding=0 с tool-area).
        mainEl.style.transition = 'none';
        document.documentElement.style.removeProperty('--sheet-h');
        document.body.classList.remove('has-sheet');
        void mainEl.offsetHeight;
        mainEl.style.transition = '';
      }
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

function fmtMoney(n: number): string {
  return n.toLocaleString('ru-KZ') + ' ₸';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}
