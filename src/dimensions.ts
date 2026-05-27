// CAD-стиль размерные линии: SVG-оверлей поверх 3D-канваса.
// Анкеры — углы фасада в 3D, проецируются на 2D каждый кадр.
//
// Геометрия:
//   • Width-размер  — снизу от фасада: extension lines из углов вниз, dim-line поперёк, стрелки, текст.
//   • Height-размер — слева от фасада: extension lines из углов влево, dim-line по вертикали, стрелки, текст.

export interface Pt2 { x: number; y: number; }

interface Corners {
  bl: Pt2; // bottom-left
  br: Pt2; // bottom-right
  tl: Pt2; // top-left
}

const NS = 'http://www.w3.org/2000/svg';
const COLOR = '#3a4258';
const OFFSET = 40;        // расстояние от ребра фасада до размерной линии, px
const EXT_GAP = 6;        // зазор между углом фасада и началом extension line, px
const EXT_EXTRA = 8;      // насколько extension line "вылетает" за dim-line, px
const ARROW = 8;          // длина стрелки, px

export function createDimensionsOverlay(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;
  if (!parent) throw new Error('canvas has no parent');

  // Убедимся, что родитель имеет position для абсолютного позиционирования оверлея
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'dim-overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;font-family:ui-sans-serif,system-ui,sans-serif';
  parent.appendChild(svg);

  // Кэш узлов для апдейта без пересоздания
  const w = mkDim(svg);
  const h = mkDim(svg);

  return {
    update(width: number, height: number, corners: Corners) {
      // Width: между bl и br, смещаем вниз (perpendicular = (0,1) screen)
      drawDim(w, corners.bl, corners.br, { dx: 0, dy: OFFSET }, `${width}`);
      // Height: между tl и bl, смещаем влево (perpendicular = (-1,0) screen)
      drawDim(h, corners.tl, corners.bl, { dx: -OFFSET, dy: 0 }, `${height}`);
    },
    dispose() { svg.remove(); },
  };
}

// ── Внутреннее: создание SVG-узлов для одного размера ─────────────────────────

interface DimNodes {
  ext1: SVGLineElement;
  ext2: SVGLineElement;
  dim:  SVGLineElement;
  arr1: SVGPolygonElement;
  arr2: SVGPolygonElement;
  textBg: SVGRectElement;
  text: SVGTextElement;
}

function mkDim(svg: SVGSVGElement): DimNodes {
  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);
  const ext1 = mkLine(g);
  const ext2 = mkLine(g);
  const dim  = mkLine(g);
  const arr1 = mkArrow(g);
  const arr2 = mkArrow(g);
  const textBg = document.createElementNS(NS, 'rect');
  textBg.setAttribute('fill', 'white');
  textBg.setAttribute('rx', '2');
  g.appendChild(textBg);
  const text = document.createElementNS(NS, 'text');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'middle');
  text.setAttribute('font-size', '12');
  text.setAttribute('font-weight', '600');
  text.setAttribute('fill', COLOR);
  g.appendChild(text);
  return { ext1, ext2, dim, arr1, arr2, textBg, text };
}

function mkLine(g: SVGGElement): SVGLineElement {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('stroke', COLOR);
  l.setAttribute('stroke-width', '1');
  g.appendChild(l);
  return l;
}

function mkArrow(g: SVGGElement): SVGPolygonElement {
  const p = document.createElementNS(NS, 'polygon');
  p.setAttribute('fill', COLOR);
  g.appendChild(p);
  return p;
}

// ── Отрисовка одного размера ─────────────────────────────────────────────────
//
// a, b: углы фасада (на которые "крепится" размер)
// off:  смещение размерной линии от ребра (в направлении perpendicular)
// label: подпись (например, "800")
//
// Геометрия:
//   • extension lines:  a → a + off + EXT_EXTRA
//                       b → b + off + EXT_EXTRA
//     (с маленьким зазором EXT_GAP от a/b чтобы не залезать на фасад)
//   • dimension line: (a + off) → (b + off)
//   • стрелки на концах dimension line (направлены вдоль линии)
//   • текст по центру dimension line, на белом фоне
function drawDim(n: DimNodes, a: Pt2, b: Pt2, off: { dx: number; dy: number }, label: string) {
  // Точки размерной линии
  const a2 = { x: a.x + off.dx, y: a.y + off.dy };
  const b2 = { x: b.x + off.dx, y: b.y + off.dy };

  // Единичный вектор смещения (нормаль к ребру)
  const offLen = Math.hypot(off.dx, off.dy) || 1;
  const nx = off.dx / offLen, ny = off.dy / offLen;

  // Extension lines: от точки a/b чуть отступая до a2/b2 + extra
  setLine(n.ext1, a.x + nx * EXT_GAP, a.y + ny * EXT_GAP,
                  a2.x + nx * EXT_EXTRA, a2.y + ny * EXT_EXTRA);
  setLine(n.ext2, b.x + nx * EXT_GAP, b.y + ny * EXT_GAP,
                  b2.x + nx * EXT_EXTRA, b2.y + ny * EXT_EXTRA);

  // Dimension line
  setLine(n.dim, a2.x, a2.y, b2.x, b2.y);

  // Стрелки: направление вдоль dim-line, длина ARROW px
  const dx = b2.x - a2.x, dy = b2.y - a2.y;
  const dLen = Math.hypot(dx, dy) || 1;
  const tx = dx / dLen, ty = dy / dLen;   // tangent
  const px = -ty, py = tx;                // perpendicular для "крыльев" стрелки

  // Стрелка у a2: треугольник от a2 к (a2 + tangent*ARROW), толщина ARROW*0.6
  arrowAt(n.arr1, a2, tx, ty, px, py);
  // Стрелка у b2: смотрит в обратную сторону (от b2 внутрь линии)
  arrowAt(n.arr2, b2, -tx, -ty, px, py);

  // Текст
  const cx = (a2.x + b2.x) / 2, cy = (a2.y + b2.y) / 2;
  n.text.setAttribute('x', String(cx));
  n.text.setAttribute('y', String(cy));
  n.text.textContent = label;
  // Подгоняем подложку под размер текста
  const bb = n.text.getBBox();
  n.textBg.setAttribute('x', String(bb.x - 4));
  n.textBg.setAttribute('y', String(bb.y - 1));
  n.textBg.setAttribute('width',  String(bb.width  + 8));
  n.textBg.setAttribute('height', String(bb.height + 2));
}

function setLine(l: SVGLineElement, x1: number, y1: number, x2: number, y2: number) {
  l.setAttribute('x1', String(x1));
  l.setAttribute('y1', String(y1));
  l.setAttribute('x2', String(x2));
  l.setAttribute('y2', String(y2));
}

function arrowAt(p: SVGPolygonElement, tip: Pt2, tx: number, ty: number, px: number, py: number) {
  // Точки: tip; tip + tangent*ARROW + perp*ARROW*0.35; tip + tangent*ARROW - perp*ARROW*0.35
  const halfW = ARROW * 0.35;
  const x1 = tip.x;
  const y1 = tip.y;
  const x2 = tip.x + tx * ARROW + px * halfW;
  const y2 = tip.y + ty * ARROW + py * halfW;
  const x3 = tip.x + tx * ARROW - px * halfW;
  const y3 = tip.y + ty * ARROW - py * halfW;
  p.setAttribute('points', `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
}
