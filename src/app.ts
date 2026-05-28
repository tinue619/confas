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

type ToolId = 'size' | 'material' | 'hinges';

const ICON = {
  ruler: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/></svg>`,
  palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>`,
  wrench: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4z"/><path d="M14.7 6.3 17 4l3 3-2.3 2.3"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.3 11.3a2 2 0 0 0 2 1.7h8.4a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v7M14 11v7"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`,
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
      <div class="logo">Facade<span>Mod</span></div>
      <div class="price-tag" id="price-tag">—</div>
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
  let activeTool: ToolId = 'size';
  const tools: { id: ToolId; icon: string; label: string }[] = [
    { id: 'size',     icon: ICON.ruler,   label: 'Размеры' },
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
    if (activeTool === 'size')     mountSizeTool(toolArea, fs, refresh);
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
  renderer?.setEditingHinge(index);
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

  // Магнитные точки = «стандартная» расстановка для текущего количества петель.
  const standard = autoHingePositions(model.hinges, sideLen);
  const snapPoints = standard.filter(p => p >= minBound && p <= maxBound);

  openSheet(`Петля #${index + 1}`, (body, close) => {
    let currentValue = editVal;

    new WheelPicker({
      parent: body,
      name: labelFromStart, unit: 'мм',
      min: minBound, max: maxBound, value: currentValue,
      mirrorMax: sideLen, mirrorLabel: labelFromEnd,
      snapPoints, snapTolerance: 18,
      // Для горизонтальных сторон «слева» должно быть визуально слева.
      // value-readout = «слева» (от начала), значит он идёт в левую колонку.
      valueOnLeft: !isVertical,
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

function mountSizeTool(area: HTMLElement, fs: FacadeState, refresh: () => void) {
  toolHeader(area, 'Размеры фасада', 'Прокрути · 1мм');
  new WheelPicker({
    parent: area, axis: 'X', name: 'Ширина', unit: 'мм',
    min: 100, max: 2250, value: fs.width,
    onChange: v => { fs.width = v; refresh(); },
  });
  new WheelPicker({
    parent: area, axis: 'Y', name: 'Высота', unit: 'мм',
    min: 100, max: 3210, value: fs.height,
    onChange: v => { fs.height = v; refresh(); },
  });
}

function mountMaterialTool(area: HTMLElement, fs: FacadeState, refresh: () => void) {
  toolHeader(area, 'Материалы', 'Свайп для выбора');

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
  toolHeader(area, 'Петли и присадка', 'Тап по петле — изменить · по краю — добавить');

  if (!model.drilling || !model.hinges) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:14px;color:#7a7670;font-size:12px';
    note.textContent = 'У этой модели не задана присадка/петли.';
    area.appendChild(note);
    return;
  }

  // Режим выбора больше нет — присадка с петлями всегда включены.
  if (fs.hingeMode === 'none') fs.hingeMode = 'holes+hinges';
  if (fs.hingePositions.length === 0) {
    fs.hingePositions = autoHingePositions(model.hinges, sideLength(fs));
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

  // Аккуратная текстовая ссылка-кнопка: иконка + лейбл + счётчик
  const reset = document.createElement('button');
  reset.className = 'link-btn';
  reset.innerHTML = `<span class="link-btn-icon">${ICON.redo}</span>Расставить автоматически <span class="link-btn-count">${fs.hingePositions.length} шт</span>`;
  reset.onclick = () => {
    fs.hingePositions = autoHingePositions(model.hinges, sideLength(fs));
    refresh();
    remount();
  };
  area.appendChild(reset);
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
function openSheet(title: string, render: (body: HTMLElement, close: () => void) => void, opts: OpenSheetOpts = {}) {
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

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('sheet-overlay--open');
    sheet.classList.remove('sheet--open');
    sheet.style.transform = '';
    setTimeout(() => { overlay.remove(); sheet.remove(); }, 250);
    onClose?.();
  };
  render(body, close);
  requestAnimationFrame(() => {
    overlay.classList.add('sheet-overlay--open');
    sheet.classList.add('sheet--open');
  });
  overlay.onclick = close;

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
