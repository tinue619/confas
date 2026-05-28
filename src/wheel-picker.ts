// Колесо-пикер числового значения. Тики рисуются в canvas — без тысяч DOM-нод.

export interface WheelPickerOpts {
  parent: HTMLElement;
  axis?:  string;          // "X", "Y" — короткая метка
  name:   string;          // "Ширина"
  unit?:  string;          // "мм"
  min:    number;
  max:    number;
  value:  number;
  pxPerMm?: number;        // 1мм = N px ленты, дефолт 4
  /** Если задано — слева в шапке покажет (mirrorMax - value) с подписью mirrorLabel */
  mirrorMax?: number;
  mirrorLabel?: string;
  /** Магнитные точки в мм — значение «прилипает» к ним в радиусе snapTolerance */
  snapPoints?: number[];
  /** Радиус притяжения, мм (дефолт 6) */
  snapTolerance?: number;
  /** Если true — value-readout слева, mirror справа (по умолчанию value справа) */
  valueOnLeft?: boolean;
  onChange: (v: number) => void;
}

export class WheelPicker {
  private track: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readoutEl: HTMLElement;
  private mirrorReadoutEl: HTMLElement | null = null;
  private centerEl!: HTMLElement;
  private mirrorMax: number | null;
  private min: number; private max: number;
  private value: number;
  private pxPerMm: number;
  private unit: string;
  private snapPoints: number[];
  private snapTolerance: number;
  private onChange: (v: number) => void;

  private isDragging = false;
  private startX = 0;
  private startValue = 0;
  private velocity = 0;
  private lastX = 0;
  private lastTime = 0;
  private momentumId: number | null = null;
  private lastHapticValue: number;
  private trackW = 0;
  private trackH = 0;
  private dpr = 1;
  private ro: ResizeObserver | null = null;

  constructor(o: WheelPickerOpts) {
    this.min = o.min; this.max = o.max; this.value = o.value;
    this.pxPerMm = o.pxPerMm ?? 4;
    this.unit = o.unit ?? '';
    this.mirrorMax = o.mirrorMax ?? null;
    this.snapPoints = (o.snapPoints ?? []).slice().sort((a, b) => a - b);
    this.snapTolerance = o.snapTolerance ?? 6;
    this.onChange = o.onChange;
    this.lastHapticValue = o.value;

    const block = document.createElement('div');
    block.className = 'wheel-block' + (o.valueOnLeft ? ' wheel-block--swap' : '');
    const valueHtml = `<div class="wheel-readout">
        <span class="readout"></span><span class="unit">${this.unit}</span>
        ${this.mirrorMax !== null ? `<span class="mirror-label">${o.name}</span>` : ''}
      </div>`;
    const leftHtml = this.mirrorMax !== null
      ? `<div class="wheel-mirror">
           <span class="mirror-readout">0</span><span class="unit">${this.unit}</span>
           ${o.mirrorLabel ? `<span class="mirror-label">${o.mirrorLabel}</span>` : ''}
         </div>`
      : `<div class="wheel-title">
           ${o.axis ? `<span class="wheel-axis">${o.axis}</span>` : ''}
           <span class="wheel-name">${o.name}</span>
         </div>`;
    // По умолчанию value справа, mirror слева. valueOnLeft=true — наоборот.
    const headerInner = o.valueOnLeft
      ? `${valueHtml}${leftHtml}`
      : `${leftHtml}${valueHtml}`;
    block.innerHTML = `
      <div class="wheel-header">
        ${headerInner}
      </div>
      <div class="wheel-track">
        <canvas class="wheel-canvas"></canvas>
        <div class="wheel-center"></div>
      </div>`;
    // Выравнивание readout'ов под их визуальную сторону
    o.parent.appendChild(block);

    this.track     = block.querySelector('.wheel-track') as HTMLDivElement;
    this.canvas    = block.querySelector('.wheel-canvas') as HTMLCanvasElement;
    this.ctx       = this.canvas.getContext('2d')!;
    this.centerEl  = block.querySelector('.wheel-center') as HTMLElement;
    this.readoutEl = block.querySelector('.readout') as HTMLElement;
    this.mirrorReadoutEl = block.querySelector('.mirror-readout');

    // Тап по числу → редактирование вручную
    this.readoutEl.classList.add('editable');
    this.readoutEl.addEventListener('click', () => this.startEdit('value'));
    if (this.mirrorReadoutEl) {
      this.mirrorReadoutEl.classList.add('editable');
      this.mirrorReadoutEl.addEventListener('click', () => this.startEdit('mirror'));
    }

    this.resize();
    this.update(o.value, false);
    this.bindEvents();

    this.ro = new ResizeObserver(() => { this.resize(); this.draw(); });
    this.ro.observe(this.track);
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.track.getBoundingClientRect();
    this.trackW = Math.max(1, rect.width);
    this.trackH = Math.max(1, rect.height);
    this.dpr = dpr;
    this.canvas.style.width = this.trackW + 'px';
    this.canvas.style.height = this.trackH + 'px';
    this.canvas.width = Math.round(this.trackW * dpr);
    this.canvas.height = Math.round(this.trackH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.trackW, h = this.trackH;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const halfMm = Math.ceil((w / 2) / this.pxPerMm) + 2;
    const from = Math.max(this.min, Math.floor(this.value) - halfMm);
    const to   = Math.min(this.max, Math.floor(this.value) + halfMm);

    ctx.lineCap = 'butt';

    for (let mm = from; mm <= to; mm++) {
      const x = cx + (mm - this.value) * this.pxPerMm;
      const isMajor = mm % 100 === 0;
      const isMid   = !isMajor && mm % 10 === 0;
      let len: number; let color: string; let lw: number;
      if (isMajor)      { len = 20; color = 'rgba(122,118,112,1)';  lw = 1.5; }
      else if (isMid)   { len = 14; color = 'rgba(74,72,68,1)';     lw = 1; }
      else              { len = 8;  color = 'rgba(53,51,48,1)';     lw = 1; }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      // Чёткие линии: на нечётной толщине сдвигаем на 0.5
      const px = lw < 1.5 ? Math.round(x) + 0.5 : Math.round(x);
      ctx.moveTo(px, cy - len / 2);
      ctx.lineTo(px, cy + len / 2);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = 'rgba(74,72,68,1)';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(mm), x, cy + len / 2 + 2);
      }
    }

    // Магнитные точки — акцентные маркеры с подсветкой
    for (const sp of this.snapPoints) {
      if (sp < from || sp > to) continue;
      const x = Math.round(cx + (sp - this.value) * this.pxPerMm);
      // Светящийся фон
      const grad = ctx.createRadialGradient(x, cy, 0, x, cy, 14);
      grad.addColorStop(0, 'rgba(200,169,110,0.25)');
      grad.addColorStop(1, 'rgba(200,169,110,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - 14, 0, 28, h);
      // Якорный треугольник сверху
      ctx.fillStyle = 'rgba(200,169,110,1)';
      ctx.beginPath();
      ctx.moveTo(x, cy - 10);
      ctx.lineTo(x - 4, cy - 16);
      ctx.lineTo(x + 4, cy - 16);
      ctx.closePath();
      ctx.fill();
    }
  }

  update(newValue: number, doCallback = true) {
    let v = Math.round(Math.min(this.max, Math.max(this.min, newValue)));
    // Магнит к стандартным точкам с гистерезисом:
    // если уже залипли — нужно отойти подальше (1.6× tolerance), чтобы отлипнуть.
    if (this.snapPoints.length) {
      const stuck = this.snapPoints.includes(this.value) ? this.value : null;
      const tol = this.snapTolerance;
      if (stuck !== null && Math.abs(v - stuck) <= tol * 1.25) {
        v = stuck;
      } else {
        let best = v, bestD = tol + 1;
        for (const sp of this.snapPoints) {
          const d = Math.abs(v - sp);
          if (d <= tol && d < bestD) { best = sp; bestD = d; }
        }
        v = best;
      }
    }
    const changed = v !== this.value;
    this.value = v;
    this.draw();
    this.readoutEl.textContent = String(v);
    if (this.centerEl) {
      this.centerEl.classList.toggle('snapped', this.snapPoints.includes(v));
    }
    if (this.mirrorReadoutEl && this.mirrorMax !== null) {
      this.mirrorReadoutEl.textContent = String(Math.max(0, this.mirrorMax - v));
    }
    if (changed && doCallback) this.onChange(v);
    if (changed && (navigator as any).vibrate && Math.abs(v - this.lastHapticValue) >= 1) {
      (navigator as any).vibrate(1);
      this.lastHapticValue = v;
    }
  }

  setValue(v: number) { this.update(v, false); }
  getValue(): number { return this.value; }

  private startEdit(which: 'value' | 'mirror') {
    const target = which === 'value' ? this.readoutEl : this.mirrorReadoutEl!;
    if (!target || target.querySelector('input')) return;
    const initial = target.textContent ?? '';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = initial;
    input.className = 'readout-input';
    target.textContent = '';
    target.appendChild(input);
    input.focus();
    input.select();

    const finish = (commit: boolean) => {
      if (commit) {
        const raw = parseInt(input.value.replace(/\D/g, ''), 10);
        if (!isNaN(raw)) {
          const v = which === 'mirror' && this.mirrorMax !== null
            ? this.mirrorMax - raw
            : raw;
          this.update(v);
        }
      }
      // Восстанавливаем текстовое содержимое — update() уже выставит правильные значения
      target.textContent = String(which === 'value'
        ? this.value
        : (this.mirrorMax !== null ? Math.max(0, this.mirrorMax - this.value) : 0));
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); input.blur(); }
    });
    input.addEventListener('blur', () => finish(true), { once: true });
  }

  destroy() {
    this.ro?.disconnect();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup',   this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    if (this.momentumId !== null) cancelAnimationFrame(this.momentumId);
  }

  private bindEvents() {
    this.track.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup',   this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.track.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onDown = (e: PointerEvent) => {
    this.track.setPointerCapture(e.pointerId);
    this.isDragging = true;
    this.startX = e.clientX;
    this.startValue = this.value;
    this.lastX = e.clientX;
    this.lastTime = performance.now();
    this.velocity = 0;
    if (this.momentumId !== null) cancelAnimationFrame(this.momentumId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.isDragging) return;
    e.preventDefault();
    const dx = e.clientX - this.startX;
    this.update(this.startValue - dx / this.pxPerMm);
    const now = performance.now();
    const dt = now - this.lastTime;
    if (dt > 0) this.velocity = (e.clientX - this.lastX) / dt;
    this.lastX = e.clientX; this.lastTime = now;
  };

  private onUp = () => {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (Math.abs(this.velocity) > 0.05) this.startMomentum();
  };

  private startMomentum() {
    let v = this.velocity;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      this.update(this.value - (v * dt) / this.pxPerMm);
      v *= Math.pow(0.95, dt / 16);
      if (Math.abs(v) < 0.01) { this.velocity = 0; return; }
      this.momentumId = requestAnimationFrame(tick);
    };
    this.momentumId = requestAnimationFrame(tick);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const d = e.deltaY || e.deltaX;
    const step = Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 30));
    this.update(this.value + step);
  };
}
