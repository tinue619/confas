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

type ToolId = 'material' | 'hinges';

const ICON = {
  palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>`,
  wrench: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4z"/><path d="M14.7 6.3 17 4l3 3-2.3 2.3"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.3 11.3a2 2 0 0 0 2 1.7h8.4a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v7M14 11v7"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`,
  mirror: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M8 8 4 12l4 4"/><path d="m16 8 4 4-4 4"/></svg>`,
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
      </div>
      <div class="tool-area" id="tool-area"></div>
      <div class="tool-switcher" id="tool-switcher"></div>
    </main>
  `);

  const canvas = document.getElementById('facade-canvas') as HTMLCanvasElement;
  const toolArea = document.getElementById('tool-area') as HTMLDivElement;
  const switcher = document.getElementById('tool-switcher') as HTMLDivElement;
  const priceTag = document.getElementById('price-tag') as HTMLElement;
  const cartBtn  = document.getElementById('cart-btn') as HTMLButtonElement;
  const cartTotal = document.getElementById('cart-total') as HTMLElement;
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

  // ── Переключатель инструментов ─────────────────────────────────────────
  let activeTool: ToolId = 'material';
  const tools: { id: ToolId; icon: string; label: string }[] = [
    { id: 'material', icon: ICON.palette, label: 'Материалы' },
    { id: 'hinges',   icon: ICON.wrench,  label: 'Петли' },
  ];
  for (const t of tools) {
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.innerHTML = `<span class="tool-icon">${t.icon}</span><span>${t.label}</span>`;
    b.onclick = () => { activeTool = t.id; renderTool(); };
    switcher.appendChild(b);
  }

  function renderTool() {
    Array.from(switcher.children).forEach((el, i) => {
      (el as HTMLElement).classList.toggle('active', tools[i].id === activeTool);
    });
    toolArea.innerHTML = '';
    if (activeTool === 'material') mountMaterialTool(toolArea, fs, refresh);
    if (activeTool === 'hinges')   mountHingesTool(toolArea, fs, model, refresh);
  }

  // ── Корзина ────────────────────────────────────────────────────────────
  cartBtn.onclick = () => openCartSheet(fs, model, refresh);

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
  if (hit.kind === 'dim') {
    openDimensionEditor(fs, model, hit.axis, refresh);
    return;
  }
  if (hit.kind === 'hinge') {
    openHingeEditor(fs, model, hit.index, refresh, renderer);
  } else if (hit.kind === 'empty') {
    // Добавление = «расставить заново» для нового количества петель.
    const sideLen = sideLength(fs);
    const newCount = fs.hingePositions.length + 1;
    const endOffset = model.hinges?.endOffset ?? 100;
    fs.hingePositions = spreadHinges(newCount, sideLen, endOffset);
    refresh();
    // Открываем редактор на ближайшей к тапу петле
    let nearestIdx = 0, nearestDist = Infinity;
    for (let i = 0; i < fs.hingePositions.length; i++) {
      const d = Math.abs(fs.hingePositions[i] - hit.mm);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    openHingeEditor(fs, model, nearestIdx, refresh, renderer);
  }
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
      mirrorMax: sideLen, mirrorLabel: labelFromEnd,
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
  }, { dim: false, onClose: () => renderer?.setEditingHinge(null) });
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
  }, { dim: false });
}

function mountMaterialTool(area: HTMLElement, fs: FacadeState, refresh: () => void) {
  toolHeader(area, 'Материалы', 'Тап для выбора');

  new Carousel<ProfileColor>({
    parent: area, name: 'Цвет профиля',
    items: Object.entries(PROFILE_COLORS).map(([k, v]) => ({
      value: k as ProfileColor, label: v.name, swatch: v.hex,
    })),
    value: fs.profileColor,
    onChange: v => { fs.profileColor = v; refresh(); },
  });

  new Carousel<GlassColor>({
    parent: area, name: 'Цвет стекла',
    items: Object.entries(GLASS_COLORS).map(([k, v]) => ({
      value: k as GlassColor, label: v.name, swatch: v.hex,
    })),
    value: fs.glassColor,
    onChange: v => { fs.glassColor = v; refresh(); },
  });

  new Carousel<GlassType>({
    parent: area, name: 'Тип стекла',
    items: Object.entries(GLASS_TYPES).map(([k, v]) => ({
      value: k as GlassType, label: v.name,
    })),
    value: fs.glassType,
    onChange: v => { fs.glassType = v; refresh(); },
  });

  // Закалка — toggle
  const row = document.createElement('div');
  row.className = 'toggle-row';
  row.innerHTML = `<label>Закалённое стекло</label><div class="toggle ${fs.tempered ? 'on' : ''}"></div>`;
  const toggle = row.querySelector('.toggle') as HTMLElement;
  toggle.onclick = () => {
    fs.tempered = !fs.tempered;
    toggle.classList.toggle('on', fs.tempered);
    refresh();
  };
  area.appendChild(row);
}

function mountHingesTool(area: HTMLElement, fs: FacadeState, model: any, refresh: () => void) {
  toolHeader(area, 'Петли и присадка', 'Тап — править · край — добавить');

  if (!model.drilling || !model.hinges) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:14px;color:#7a7670;font-size:12px';
    note.textContent = 'У этой модели не задана присадка/петли.';
    area.appendChild(note);
    return;
  }

  // Режим выбора больше нет. Авто-заливка дефолтных позиций — только при
  // первом входе в инструмент (когда mode='none'). Иначе уважаем пустой массив,
  // чтобы пользователь мог явно выбрать 0 петель через степпер.
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

  new Carousel<HingeSide>({
    parent: area, name: 'Сторона',
    items: [
      { value: 'left',   label: 'Лево' },
      { value: 'right',  label: 'Право' },
      { value: 'top',    label: 'Верх' },
      { value: 'bottom', label: 'Низ' },
    ],
    value: fs.hingeSide,
    onChange: v => {
      fs.hingeSide = v;
      fs.hingePositions = autoHingePositions(model.hinges, sideLength(fs));
      refresh();
      remount();
    },
  });

  // Количество петель: − N + (с авто-перераспределением)
  const sideLen = sideLength(fs);
  const endOffset = model.hinges?.endOffset ?? 100;
  const count = fs.hingePositions.length;
  // Максимум: 60мм отступа с каждого края + 45мм зазор между петлями
  const maxCount = Math.max(1, Math.floor((sideLen - 120) / 45) + 1);
  const setCount = (n: number) => {
    fs.hingePositions = spreadHinges(Math.max(0, Math.min(maxCount, n)), sideLen, endOffset);
    refresh();
    remount();
  };

  const countRow = document.createElement('div');
  countRow.className = 'stepper-row';
  countRow.innerHTML = `
    <span class="stepper-label">Количество петель</span>
    <div class="stepper">
      <button class="stepper-btn" data-act="dec" ${count <= 0 ? 'disabled' : ''}>−</button>
      <span class="stepper-val">${count}</span>
      <button class="stepper-btn" data-act="inc" ${count >= maxCount ? 'disabled' : ''}>+</button>
    </div>`;
  (countRow.querySelector('[data-act="dec"]') as HTMLButtonElement).onclick = () => setCount(count - 1);
  (countRow.querySelector('[data-act="inc"]') as HTMLButtonElement).onclick = () => setCount(count + 1);
  area.appendChild(countRow);

  // Действия: расставить заново + отразить
  const actions = document.createElement('div');
  actions.className = 'link-btn-row';

  const reset = document.createElement('button');
  reset.className = 'link-btn';
  reset.innerHTML = `<span class="link-btn-icon">${ICON.redo}</span>Расставить заново`;
  reset.disabled = count === 0;
  reset.onclick = () => { setCount(count); };

  const mirror = document.createElement('button');
  mirror.className = 'link-btn';
  mirror.innerHTML = `<span class="link-btn-icon">${ICON.mirror}</span>Зеркально`;
  mirror.disabled = count < 2;
  mirror.onclick = () => {
    fs.hingePositions = fs.hingePositions.map(p => sideLen - p).sort((a, b) => a - b);
    refresh();
    remount();
  };

  actions.append(reset, mirror);
  area.appendChild(actions);
}

function toolHeader(area: HTMLElement, title: string, hint = '') {
  const h = document.createElement('div');
  h.className = 'tool-header';
  h.innerHTML = `<div class="tool-title">${title}</div><div class="tool-hint">${hint}</div>`;
  area.appendChild(h);
}

// ─── Корзина (шторка) ─────────────────────────────────────────────────────────

function openCartSheet(fs: FacadeState, model: any, refresh: () => void) {
  openSheet('Корзина', (body, close) => {
    const renderInside = () => {
      body.innerHTML = '';
      fillCart(body, () => renderInside(), close);

      const ctaRow = document.createElement('div');
      ctaRow.className = 'btn-row';
      ctaRow.style.marginTop = '6px';
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary';
      addBtn.textContent = '+ Добавить этот фасад';
      addBtn.onclick = () => {
        const br = calcPrice(model, fs);
        const cfg: FacadeConfig = {
          width: fs.width, height: fs.height,
          profileColor: fs.profileColor, glassColor: fs.glassColor, glassType: fs.glassType,
          tempered: fs.tempered, hingeMode: fs.hingeMode, hingeSide: fs.hingeSide,
          hingePositions: [...fs.hingePositions],
        };
        store.addItem({
          id: store.newId(),
          modelRef: { category: 'facade', modelId: 'wide' },
          modelName: model.name,
          config: cfg, priceSnapshot: br, qty: 1,
          addedAt: new Date().toISOString(),
        });
        renderInside();
        refresh();
      };
      ctaRow.appendChild(addBtn);
      body.appendChild(ctaRow);
    };
    renderInside();
  });
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

  for (const item of order.items) {
    const row = document.createElement('div');
    row.className = 'cart-row';
    const info = document.createElement('div');
    info.className = 'cart-row-info';
    info.innerHTML = `
      <div class="cart-row-name">${escapeHtml(item.modelName)}</div>
      <div class="cart-row-spec">${configSummary(item.config)}</div>
      <div class="cart-row-unit">за шт: ${fmtMoney(item.priceSnapshot.total)}</div>`;
    row.appendChild(info);

    const right = document.createElement('div');
    right.className = 'cart-row-controls';
    const qty = document.createElement('div');
    qty.className = 'qty-box';
    const minus = mkQty('−'), plus = mkQty('+');
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '1'; inp.value = String(item.qty);
    inp.className = 'qty-input';
    inp.onchange = () => { store.setQty(item.id, parseInt(inp.value, 10) || 1); rerender(); };
    minus.onclick = () => { store.setQty(item.id, item.qty - 1); rerender(); };
    plus.onclick  = () => { store.setQty(item.id, item.qty + 1); rerender(); };
    qty.append(minus, inp, plus);
    const sum = document.createElement('div');
    sum.className = 'cart-row-sum';
    sum.textContent = fmtMoney(item.priceSnapshot.total * item.qty);
    const del = document.createElement('button');
    del.className = 'cart-row-del';
    del.textContent = '✕ Удалить';
    del.onclick = () => { store.removeItem(item.id); rerender(); };
    right.append(qty, sum, del);
    row.appendChild(right);
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

function mkQty(t: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'qty-btn'; b.textContent = t;
  return b;
}

function configSummary(c: FacadeConfig): string {
  const parts = [
    `${c.width}×${c.height}мм`,
    PROFILE_COLORS[c.profileColor]?.name,
    GLASS_COLORS[c.glassColor]?.name,
    GLASS_TYPES[c.glassType]?.name,
  ];
  if (c.tempered) parts.push('закалка');
  if (c.hingeMode !== 'none' && c.hingePositions.length > 0) {
    const sideRu = { left: 'лево', right: 'право', top: 'верх', bottom: 'низ' }[c.hingeSide];
    parts.push(`${c.hingeMode === 'holes' ? 'присадка' : 'петли'} ${sideRu}×${c.hingePositions.length}`);
  }
  return parts.filter(Boolean).join(' · ');
}

// ─── Bottom sheet helper ──────────────────────────────────────────────────────

interface OpenSheetOpts { dim?: boolean; onClose?: () => void }
let activeSheetClose: (() => void) | null = null;
function openSheet(title: string, render: (body: HTMLElement, close: () => void) => void, opts: OpenSheetOpts = {}) {
  // Закрываем предыдущую шторку без анимации — чтобы не дублировались
  activeSheetClose?.();
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

  // Усаживаем основную область под высоту шторки.
  const updateSheetH = () => {
    const h = sheet.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--sheet-h', h + 'px');
  };
  const sheetRo = new ResizeObserver(updateSheetH);
  document.body.classList.add('has-sheet');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (activeSheetClose === close) activeSheetClose = null;
    sheetRo.disconnect();
    overlay.classList.remove('sheet-overlay--open');
    sheet.classList.remove('sheet--open');
    sheet.style.transform = '';
    // Шторка едет вниз — оставляем padding-bottom, чтобы canvas не подрос «через» неё.
    // После анимации убираем — canvas мгновенно расширяется.
    setTimeout(() => {
      document.documentElement.style.removeProperty('--sheet-h');
      document.body.classList.remove('has-sheet');
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
