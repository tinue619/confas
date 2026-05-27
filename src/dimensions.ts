// Размерные обозначения CAD-стиля.
//
// Разделение ответственности:
//   • Линии (extension + dim) — 3D-меши (LinesMesh), живут в сцене, вращаются с фасадом.
//   • Текстовые подписи — SVG-оверлей поверх канваса, всегда плоско к камере (читаемо).
//
// Что отображается:
//   • Габариты: ширина (снизу) + высота (слева).
//   • Цепочка петель: если есть hingePositions — сегменты по стороне:
//       край → петля → петля → ... → край (со всеми расстояниями).

import {
  Scene, Engine, ArcRotateCamera, Mesh, MeshBuilder, TransformNode,
  Vector3, Color3, Matrix,
} from '@babylonjs/core';
import { FacadeState, type HingeSide } from './state';

const COLOR = new Color3(0.23, 0.26, 0.35);   // dark blue-grey (#3a4258)
const TEXT_COLOR = '#3a4258';

const OFFSET_MAIN = 60;     // мм — отступ основных размерных линий от ребра фасада
const OFFSET_CHAIN = 120;   // мм — отступ цепочки петель (дальше основных)
const EXT_GAP = 6;          // мм — зазор между ребром фасада и началом extension line
const EXT_EXTRA = 10;       // мм — насколько extension вылезает за dim-line

export class DimensionsManager {
  private svg: SVGSVGElement;
  private labelPool: { text: SVGTextElement; bg: SVGRectElement }[] = [];
  private meshGroup: TransformNode | null = null;
  private anchors: { pos: Vector3; text: string }[] = [];

  constructor(private scene: Scene, canvas: HTMLCanvasElement) {
    const parent = canvas.parentElement;
    if (!parent) throw new Error('canvas has no parent');
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    const NS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;font-family:ui-sans-serif,system-ui,sans-serif';
    parent.appendChild(this.svg);
  }

  /** Перестраивает 3D-меши и список якорей подписей. Вызывать при изменении fs. */
  rebuild(fs: FacadeState) {
    if (this.meshGroup) this.meshGroup.dispose(false, true);
    this.meshGroup = new TransformNode('dim-group', this.scene);
    // root фасада смещён на -W/2 по X. Размещаем размеры в той же системе.
    this.meshGroup.position.x = -fs.width / 2;
    this.anchors = [];

    const W = fs.width, H = fs.height;

    // ── Габарит ширины (снизу) ─────────────────────────────────────────────
    this.addDim(
      new Vector3(0, 0, 0),
      new Vector3(W, 0, 0),
      new Vector3(0, -1, 0),
      OFFSET_MAIN,
      `${W}`,
    );

    // ── Габарит высоты (слева) ─────────────────────────────────────────────
    this.addDim(
      new Vector3(0, 0, 0),
      new Vector3(0, H, 0),
      new Vector3(-1, 0, 0),
      OFFSET_MAIN,
      `${H}`,
    );

    // ── Цепочка петель ─────────────────────────────────────────────────────
    if (fs.hingeMode !== 'none' && fs.hingePositions.length > 0) {
      this.addHingeChain(W, H, fs.hingeSide, fs.hingePositions);
    }
  }

  /** Проецирует якоря и обновляет текстовые подписи. Вызывать каждый кадр. */
  updateOverlay(camera: ArcRotateCamera, engine: Engine) {
    this.ensureLabels(this.anchors.length);
    const W = engine.getRenderWidth();
    const Hpx = engine.getRenderHeight();
    const dpr = window.devicePixelRatio || 1;
    const viewport = camera.viewport.toGlobal(W, Hpx);
    const transformMatrix = this.scene.getTransformMatrix();
    // mesh-group смещён на -W/2 по X относительно мира — нужно учесть.
    const groupOffsetX = this.meshGroup?.position.x ?? 0;

    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      const worldPos = new Vector3(a.pos.x + groupOffsetX, a.pos.y, a.pos.z);
      const p = Vector3.Project(worldPos, Matrix.Identity(), transformMatrix, viewport);
      const lab = this.labelPool[i];
      lab.text.textContent = a.text;
      lab.text.setAttribute('x', String(p.x / dpr));
      lab.text.setAttribute('y', String(p.y / dpr));
      // Подложка под размер текста
      const bb = lab.text.getBBox();
      lab.bg.setAttribute('x', String(bb.x - 4));
      lab.bg.setAttribute('y', String(bb.y - 1));
      lab.bg.setAttribute('width',  String(bb.width  + 8));
      lab.bg.setAttribute('height', String(bb.height + 2));
      lab.text.style.display = '';
      lab.bg.style.display   = '';
    }
    // Прячем лишние лейблы пула
    for (let i = this.anchors.length; i < this.labelPool.length; i++) {
      this.labelPool[i].text.style.display = 'none';
      this.labelPool[i].bg.style.display   = 'none';
    }
  }

  dispose() {
    if (this.meshGroup) this.meshGroup.dispose(false, true);
    this.svg.remove();
  }

  // ─── Внутреннее ─────────────────────────────────────────────────────────────

  private ensureLabels(n: number) {
    while (this.labelPool.length < n) {
      const NS = 'http://www.w3.org/2000/svg';
      const bg = document.createElementNS(NS, 'rect') as SVGRectElement;
      bg.setAttribute('fill', 'white');
      bg.setAttribute('rx', '2');
      const text = document.createElementNS(NS, 'text') as SVGTextElement;
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-weight', '600');
      text.setAttribute('fill', TEXT_COLOR);
      this.svg.append(bg, text);
      this.labelPool.push({ text, bg });
    }
  }

  /** Добавить один сегмент с размером.
   *  a, b: концы измеряемого отрезка (в локальных координатах группы).
   *  perp: единичный вектор, в направлении которого выносится размер.
   *  off: расстояние от ребра до dim-line.
   */
  private addDim(a: Vector3, b: Vector3, perp: Vector3, off: number, label: string) {
    if (!this.meshGroup) return;
    const offA = a.add(perp.scale(off));
    const offB = b.add(perp.scale(off));
    const extStartA = a.add(perp.scale(EXT_GAP));
    const extEndA   = a.add(perp.scale(off + EXT_EXTRA));
    const extStartB = b.add(perp.scale(EXT_GAP));
    const extEndB   = b.add(perp.scale(off + EXT_EXTRA));

    // Extension lines
    this.line([extStartA, extEndA]);
    this.line([extStartB, extEndB]);
    // Dim line
    this.line([offA, offB]);

    // Якорь подписи — середина dim-line
    this.anchors.push({ pos: Vector3.Center(offA, offB), text: label });
  }

  /** Цепочка размеров по стороне фасада, с петлями как промежуточными точками. */
  private addHingeChain(W: number, H: number, side: HingeSide, positions: number[]) {
    // Сортируем + добавляем 0 и длину стороны
    const sideLen = (side === 'left' || side === 'right') ? H : W;
    const sorted = [...positions].sort((a, b) => a - b);
    const chain = [0, ...sorted, sideLen];

    // Преобразуем позицию вдоль стороны в (x,y), и определяем perp-направление
    // в сторону, противоположную фасаду.
    const toPoint = (t: number): Vector3 => {
      switch (side) {
        case 'left':   return new Vector3(0, t, 0);
        case 'right':  return new Vector3(W, t, 0);
        case 'top':    return new Vector3(t, H, 0);
        case 'bottom': return new Vector3(t, 0, 0);
      }
    };
    const perp: Vector3 = (() => {
      switch (side) {
        case 'left':   return new Vector3(-1, 0, 0);
        case 'right':  return new Vector3( 1, 0, 0);
        case 'top':    return new Vector3( 0, 1, 0);
        case 'bottom': return new Vector3( 0,-1, 0);
      }
    })();

    for (let i = 0; i < chain.length - 1; i++) {
      const t1 = chain[i], t2 = chain[i + 1];
      const len = Math.round(t2 - t1);
      if (len <= 0) continue;
      this.addDim(toPoint(t1), toPoint(t2), perp, OFFSET_CHAIN, `${len}`);
    }
  }

  private line(points: Vector3[]) {
    const m = MeshBuilder.CreateLines('dim-line', { points }, this.scene);
    m.color = COLOR;
    m.parent = this.meshGroup;
    m.isPickable = false;
    return m;
  }
}
