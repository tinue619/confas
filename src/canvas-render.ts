// 2D-визуализация фасада: габариты, рамка, петли, присадки, размерные линии.
// Поддерживает tap-хит-тест по петлям и по пустому пространству вдоль стороны.

import type { FacadeState, HingeSide } from './state';
import type { FacadeModel } from './model';
import { GLASS_COLORS, PROFILE_COLORS } from './catalog';

const GLASS_INSET_MM = 4; // отступ стекла от наружного края изделия, мм

const ACCENT = '#c8a96e';
const COLOR_DIM = '#7a7670';
const COLOR_DIM_DARK = '#4a4844';
const COLOR_TEXT = '#f0ede8';
const COLOR_BG_DARK = '#0f0f0f';

const PAD_BASE = 10;
const RULER_GAP = 26;
const HINGE_CHAIN_GAP = 44;
const HINGE_HIT_RADIUS = 18; // px вокруг центра петли — зона тапа
const EMPTY_HIT_BAND = 22;   // px от ребра, где tap считается "по пустому месту на стороне"

export interface HingeHit { kind: 'hinge'; index: number; }
export interface EmptyHit { kind: 'empty'; mm: number; }
export type Hit = HingeHit | EmptyHit | null;

export class FacadeRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private state!: FacadeState;
  private model!: FacadeModel;
  /** Координаты центров петель в css px после последней отрисовки */
  private hingePositionsPx: { x: number; y: number }[] = [];
  /** Геометрия фасадного прямоугольника в css px */
  private rect = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  /** Индекс петли, открытой в редакторе — её размеры подсвечиваются */
  private editingHingeIndex: number | null = null;

  onTap: ((hit: Hit) => void) | null = null;

  setEditingHinge(index: number | null) {
    this.editingHingeIndex = index;
    this.redraw();
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('no 2d context');
    this.ctx = c;
    this.container = canvas.parentElement!;
    canvas.addEventListener('pointerdown', this.onPointerDown);

    // Авто-перерисовка при любых изменениях размера контейнера
    // (переключение вкладок, изменение окна, появление клавиатуры и т.д.)
    const ro = new ResizeObserver(() => this.redraw());
    ro.observe(this.container);
  }

  setState(s: FacadeState) { this.state = s; }
  setModel(m: FacadeModel) { this.model = m; }

  redraw = () => {
    if (!this.state || !this.model) return;
    const { cw, ch } = this.setupSize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, cw, ch);

    const W = this.state.width, H = this.state.height;
    // Отступы со сторон фасада зависят от того, что там рисуется:
    //  • снизу — размер ширины,
    //  • справа — размер высоты,
    //  • на стороне петель — цепочка размеров между петлями.
    const hingeMode = this.state.hingeMode;
    const hingeOnSide = (s: 'left'|'right'|'top'|'bottom') =>
      hingeMode !== 'none' && this.state.hingeSide === s ? HINGE_CHAIN_GAP : 0;
    const padL = PAD_BASE + hingeOnSide('left');
    const padR = PAD_BASE + RULER_GAP + hingeOnSide('right');
    const padT = PAD_BASE + hingeOnSide('top');
    const padB = PAD_BASE + RULER_GAP + hingeOnSide('bottom');
    const availW = cw - padL - padR;
    const availH = ch - padT - padB;
    const scale = Math.min(availW / W, availH / H);
    const rw = Math.round(W * scale);
    const rh = Math.round(H * scale);
    const rx = Math.round(padL + (availW - rw) / 2);
    const ry = Math.round(padT + (availH - rh) / 2);
    this.rect = { x: rx, y: ry, w: rw, h: rh, scale };

    this.drawFacadeBody(rx, ry, rw, rh, scale);
    this.drawGlassArea(rx, ry, rw, rh, scale);
    this.drawHingesAndDrillings(rx, ry, rw, rh, scale);
    this.drawDimensions(rx, ry, rw, rh, W, H);
    this.drawHingeChain(rx, ry, rw, rh, scale);
  };

  // ── Setup ──────────────────────────────────────────────────────────────

  private setupSize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    this.canvas.width  = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.width  = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    return { cw, ch };
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  private drawFacadeBody(rx: number, ry: number, rw: number, rh: number, scale: number) {
    const ctx = this.ctx;
    // Видимая ширина рамы профиля в пикселях. Реальные 4мм могут быть слишком узкими
    // на маленьких канвасах — выдерживаем минимум ~7px для читаемости.
    const inset = Math.max(7, GLASS_INSET_MM * scale);
    const profileHex = PROFILE_COLORS[this.state.profileColor]?.hex ?? '#888';

    // Тёмная подложка под фасад (фон в проёме до отрисовки стекла)
    ctx.save();
    ctx.fillStyle = '#1a1815';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();

    // Заливка рамы — четыре трапеции (миты по углам)
    const outer = [
      [rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh],
    ];
    const inner = [
      [rx + inset, ry + inset],
      [rx + rw - inset, ry + inset],
      [rx + rw - inset, ry + rh - inset],
      [rx + inset, ry + rh - inset],
    ];
    ctx.save();
    ctx.fillStyle = profileHex;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      ctx.beginPath();
      ctx.moveTo(outer[i][0], outer[i][1]);
      ctx.lineTo(outer[j][0], outer[j][1]);
      ctx.lineTo(inner[j][0], inner[j][1]);
      ctx.lineTo(inner[i][0], inner[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Контуры: наружный и внутренний, плюс 45° запилы (от наружного угла к внутреннему)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
    ctx.strokeRect(rx + inset + 0.5, ry + inset + 0.5, rw - inset * 2 - 1, rh - inset * 2 - 1);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(outer[i][0] + 0.5, outer[i][1] + 0.5);
      ctx.lineTo(inner[i][0] + 0.5, inner[i][1] + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Саморезы — 2 на каждый угол (по одному на каждой смежной стороне рядом с углом)
    const screwR = Math.max(2.2, Math.min(inset * 0.32, 3.5));
    const screwOff = Math.max(14, inset * 2.5); // расстояние от угла вдоль ребра
    const halfBand = inset / 2;
    const screws: [number, number][] = [
      // top edge
      [rx + screwOff, ry + halfBand],
      [rx + rw - screwOff, ry + halfBand],
      // bottom edge
      [rx + screwOff, ry + rh - halfBand],
      [rx + rw - screwOff, ry + rh - halfBand],
      // left edge
      [rx + halfBand, ry + screwOff],
      [rx + halfBand, ry + rh - screwOff],
      // right edge
      [rx + rw - halfBand, ry + screwOff],
      [rx + rw - halfBand, ry + rh - screwOff],
    ];
    for (const [sx, sy] of screws) this.drawScrew(sx, sy, screwR);
  }

  private drawScrew(x: number, y: number, r: number) {
    const ctx = this.ctx;
    ctx.save();
    // Внешний круг — тёмный
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // Крестообразный шлиц
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.9;
    const d = r * 0.6;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
    ctx.stroke();
    ctx.restore();
  }

  private drawGlassArea(rx: number, ry: number, rw: number, rh: number, scale: number) {
    const ctx = this.ctx;
    const inset = Math.max(7, GLASS_INSET_MM * scale);
    if (inset * 2 >= rw || inset * 2 >= rh) return;
    const gx = rx + inset, gy = ry + inset;
    const gw = rw - inset * 2, gh = rh - inset * 2;
    const glassHex = GLASS_COLORS[this.state.glassColor]?.hex ?? '#c4d8de';
    ctx.save();
    ctx.fillStyle = hexToRgba(glassHex, this.state.glassType === 'matte' ? 0.22 : 0.14);
    ctx.fillRect(gx, gy, gw, gh);
    ctx.restore();
  }

  private drawHingesAndDrillings(rx: number, ry: number, rw: number, rh: number, scale: number) {
    this.hingePositionsPx = [];
    if (this.state.hingeMode === 'none' || !this.model.drilling) return;

    const ctx = this.ctx;
    const W = this.state.width, H = this.state.height;
    const { diameter, edgeOffset } = this.model.drilling;
    const r = (diameter / 2) * scale;

    for (let i = 0; i < this.state.hingePositions.length; i++) {
      const pos = this.state.hingePositions[i];
      const sideLen = (this.state.hingeSide === 'left' || this.state.hingeSide === 'right') ? H : W;
      const clamped = Math.max(0, Math.min(sideLen, pos));
      let mmX = 0, mmY = 0;
      switch (this.state.hingeSide) {
        case 'left':   mmX = edgeOffset;     mmY = clamped;       break;
        case 'right':  mmX = W - edgeOffset; mmY = clamped;       break;
        case 'top':    mmX = clamped;        mmY = H - edgeOffset; break;
        case 'bottom': mmX = clamped;        mmY = edgeOffset;    break;
      }
      // Преобразуем мм → пиксели: world Y=0 это низ, экранно — снизу
      const px = rx + mmX * scale;
      const py = ry + rh - mmY * scale;
      this.hingePositionsPx.push({ x: px, y: py });

      const isEditing = this.editingHingeIndex === i;
      // Тёмный круг = присадка
      ctx.save();
      // Подсветка-«ореол» для редактируемой петли
      if (isEditing) {
        ctx.beginPath();
        ctx.arc(px, py, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,169,110,0.18)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_BG_DARK;
      ctx.fill();
      // Контур
      ctx.strokeStyle = (this.state.hingeMode === 'holes+hinges' || isEditing) ? ACCENT : COLOR_DIM;
      ctx.lineWidth = isEditing ? 1.8 : 1.2;
      ctx.stroke();
      // Крестик в центре (центровка)
      ctx.beginPath();
      ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py);
      ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3);
      ctx.strokeStyle = COLOR_DIM;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Размеры (габариты) ────────────────────────────────────────────────

  private drawDimensions(rx: number, ry: number, rw: number, rh: number, W: number, H: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Width — снизу
    const wy = ry + rh + RULER_GAP - 6;
    this.drawDimLine(rx, wy, rx + rw, wy, formatDim(W), COLOR_DIM, ACCENT);
    // тики сверху от линии до уголков фасада
    this.drawTick(rx + 0.5, ry + rh + 4, rx + 0.5, wy);
    this.drawTick(rx + rw + 0.5, ry + rh + 4, rx + rw + 0.5, wy);

    // Height — справа
    const hx = rx + rw + RULER_GAP - 6;
    this.drawDimLineV(hx, ry, hx, ry + rh, formatDim(H), COLOR_DIM, ACCENT);
    this.drawTick(rx + rw + 4, ry + 0.5, hx, ry + 0.5);
    this.drawTick(rx + rw + 4, ry + rh + 0.5, hx, ry + rh + 0.5);

    ctx.restore();
  }

  private drawTick(x1: number, y1: number, x2: number, y2: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLOR_DIM_DARK;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawDimLine(x1: number, y1: number, x2: number, y2: number,
                      text: string, lineColor: string, textColor: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    this.drawArrow(x1, y1, 1, 0, lineColor);
    this.drawArrow(x2, y2, -1, 0, lineColor);
    ctx.fillStyle = COLOR_BG_DARK;
    const tw = ctx.measureText(text).width + 8;
    ctx.fillRect((x1 + x2) / 2 - tw / 2, y1 - 7, tw, 14);
    ctx.fillStyle = textColor;
    ctx.fillText(text, (x1 + x2) / 2, y1);
  }

  private drawDimLineV(x1: number, y1: number, x2: number, y2: number,
                       text: string, lineColor: string, textColor: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = lineColor; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    this.drawArrow(x1, y1, 0, 1, lineColor);
    this.drawArrow(x2, y2, 0, -1, lineColor);
    ctx.save();
    ctx.translate(x1, (y1 + y2) / 2);
    ctx.rotate(Math.PI / 2);
    const tw = ctx.measureText(text).width + 8;
    ctx.fillStyle = COLOR_BG_DARK;
    ctx.fillRect(-tw / 2, -7, tw, 14);
    ctx.fillStyle = textColor;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  private drawArrow(x: number, y: number, dx: number, dy: number, color: string) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    const len = 6, w = 3.5;
    if (dx !== 0) {
      ctx.moveTo(x + dx * len, y - w);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * len, y + w);
    } else {
      ctx.moveTo(x - w, y + dy * len);
      ctx.lineTo(x, y);
      ctx.lineTo(x + w, y + dy * len);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Цепочка петель ────────────────────────────────────────────────────
  private drawHingeChain(rx: number, ry: number, rw: number, rh: number, scale: number) {
    if (this.state.hingeMode === 'none' || this.state.hingePositions.length === 0) return;
    const ctx = this.ctx;
    const W = this.state.width, H = this.state.height;
    const side = this.state.hingeSide;
    const sideLen = (side === 'left' || side === 'right') ? H : W;
    const sorted = [...this.state.hingePositions].sort((a, b) => a - b);
    const chain = [0, ...sorted, sideLen];

    ctx.save();
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Преобразование позиции вдоль стороны (мм) → координаты экрана
    const toScreen = (t: number): { x: number; y: number } => {
      switch (side) {
        case 'left':   return { x: rx,      y: ry + rh - t * scale };
        case 'right':  return { x: rx + rw, y: ry + rh - t * scale };
        case 'top':    return { x: rx + t * scale, y: ry };
        case 'bottom': return { x: rx + t * scale, y: ry + rh };
      }
    };
    // Перпендикулярное направление (от ребра наружу) в экране
    const perp = (() => {
      switch (side) {
        case 'left':   return { x: -1, y:  0 };
        case 'right':  return { x:  1, y:  0 };
        case 'top':    return { x:  0, y: -1 };
        case 'bottom': return { x:  0, y:  1 };
      }
    })();
    const offset = HINGE_CHAIN_GAP - 8;

    // Значение редактируемой петли (если есть) — для подсветки соседних сегментов
    const editVal = this.editingHingeIndex !== null
      ? this.state.hingePositions[this.editingHingeIndex]
      : null;

    for (let i = 0; i < chain.length - 1; i++) {
      const t1 = chain[i], t2 = chain[i + 1];
      const len = Math.round(t2 - t1);
      if (len <= 0) continue;
      const p1 = toScreen(t1), p2 = toScreen(t2);
      const a = { x: p1.x + perp.x * offset, y: p1.y + perp.y * offset };
      const b = { x: p2.x + perp.x * offset, y: p2.y + perp.y * offset };
      // tick от ребра до линии цепочки
      this.drawTick(p1.x, p1.y, a.x, a.y);
      // если последний — рисуем и второй tick (для других сегментов он совпадёт с первым следующего)
      if (i === chain.length - 2) this.drawTick(p2.x, p2.y, b.x, b.y);
      // Сегмент примыкает к редактируемой петле — подсвечиваем
      const isHighlight = editVal !== null && (t1 === editVal || t2 === editVal);
      const lineCol = isHighlight ? ACCENT : COLOR_DIM_DARK;
      const textCol = isHighlight ? ACCENT : COLOR_TEXT;
      if (side === 'left' || side === 'right') {
        this.drawDimLineV(a.x, a.y, b.x, b.y, String(len), lineCol, textCol);
      } else {
        this.drawDimLine(a.x, a.y, b.x, b.y, String(len), lineCol, textCol);
      }
    }
    ctx.restore();
  }

  // ── Hit-test на тап ────────────────────────────────────────────────────
  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this.hitTest(x, y);
    if (hit && this.onTap) this.onTap(hit);
  };

  private hitTest(x: number, y: number): Hit {
    if (!this.state) return null;

    // 1. Попадание в петлю — приоритет
    for (let i = 0; i < this.hingePositionsPx.length; i++) {
      const p = this.hingePositionsPx[i];
      if (Math.hypot(x - p.x, y - p.y) <= HINGE_HIT_RADIUS) {
        return { kind: 'hinge', index: i };
      }
    }

    // 2. Попадание в полосу вдоль стороны (только если режим включён)
    if (this.state.hingeMode === 'none' || !this.model.drilling) return null;
    const r = this.rect;
    const side = this.state.hingeSide;
    const eo = this.model.drilling.edgeOffset * r.scale;
    let mm = -1;
    switch (side) {
      case 'left':
        if (Math.abs(x - (r.x + eo)) <= EMPTY_HIT_BAND && y >= r.y && y <= r.y + r.h) {
          mm = (r.y + r.h - y) / r.scale;
        }
        break;
      case 'right':
        if (Math.abs(x - (r.x + r.w - eo)) <= EMPTY_HIT_BAND && y >= r.y && y <= r.y + r.h) {
          mm = (r.y + r.h - y) / r.scale;
        }
        break;
      case 'top':
        if (Math.abs(y - (r.y + eo)) <= EMPTY_HIT_BAND && x >= r.x && x <= r.x + r.w) {
          mm = (x - r.x) / r.scale;
        }
        break;
      case 'bottom':
        if (Math.abs(y - (r.y + r.h - eo)) <= EMPTY_HIT_BAND && x >= r.x && x <= r.x + r.w) {
          mm = (x - r.x) / r.scale;
        }
        break;
    }
    if (mm >= 0) return { kind: 'empty', mm: Math.round(mm) };
    return null;
  }
}

function formatDim(mm: number): string {
  return mm >= 1000
    ? (mm / 1000).toFixed(3).replace('.', ',').replace(/,?0+$/, '') + ' м'
    : mm + ' мм';
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Suppress unused-warning for HingeSide
export type _HS = HingeSide;
