// 3D-просмотр фасада на Babylon.js. Грузится лениво (через dynamic import из
// app.ts), поэтому весь @babylonjs/core попадает в отдельный чанк и не
// утяжеляет базовый бандл.
//
// Геометрия строится из реального сечения профиля (section3d.parseSection):
// контур экструдируется вдоль 4 сторон рамы, стекло ставится на глубину из
// линии glass. Петли — цилиндры-маркеры в позициях из конфигурации.

import {
  Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4,
  HemisphericLight, DirectionalLight, PBRMaterial, MeshBuilder, Mesh,
  VertexData,
} from '@babylonjs/core';
import earcut from 'earcut';
import type { FacadeConfig } from './order';
import type { FacadeModel } from './model';
import { PROFILE_COLORS, GLASS_COLORS, GLASS_TYPES } from './catalog';
import { parseSection, type Section3D } from './section3d';

const MM = 0.001;

export function open3DViewer(config: FacadeConfig, model: FacadeModel) {
  const overlay = document.createElement('div');
  overlay.className = 'viewer3d-overlay';
  overlay.innerHTML = `
    <canvas class="viewer3d-canvas"></canvas>
    <button class="viewer3d-close" aria-label="Закрыть">✕</button>
    <div class="viewer3d-badge">${config.width}×${config.height} мм</div>
    <div class="viewer3d-hint">проведите пальцем — повернуть · щипок — масштаб</div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector('.viewer3d-canvas') as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = buildScene(engine, config, model);
  engine.runRenderLoop(() => scene.render());

  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);

  const close = () => {
    window.removeEventListener('resize', onResize);
    engine.stopRenderLoop();
    scene.dispose();
    engine.dispose();
    overlay.remove();
  };
  (overlay.querySelector('.viewer3d-close') as HTMLButtonElement).onclick = close;

  return close;
}

function buildScene(engine: Engine, config: FacadeConfig, model: FacadeModel): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.93, 0.92, 0.89, 1);

  const W = config.width, H = config.height;

  const camera = new ArcRotateCamera('cam',
    -Math.PI / 2.4, Math.PI / 2.6, Math.max(W, H) * MM * 1.5,
    new Vector3(0, H / 2 * MM, 0), scene);
  camera.attachControl(true);
  camera.lowerRadiusLimit = Math.max(W, H) * MM * 0.4;
  camera.upperRadiusLimit = Math.max(W, H) * MM * 4;
  camera.wheelPrecision = 40;
  camera.pinchPrecision = 60;
  camera.minZ = 0.001;
  camera.panningSensibility = 0;  // без панорамирования — только орбита/зум

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.45;
  hemi.groundColor = new Color3(0.25, 0.25, 0.27);

  const dir = new DirectionalLight('dir', new Vector3(-0.6, -1, -0.8), scene);
  dir.intensity = 2.0;
  dir.position = new Vector3(2, 3, 2);

  const dir2 = new DirectionalLight('dir2', new Vector3(0.8, -0.2, 0.9), scene);
  dir2.intensity = 0.6;

  // HDR-окружение для корректных PBR-отражений (металл рамы / блики стекла).
  // TODO: для офлайн-APK положить .env локально в /public вместо CDN.
  scene.createDefaultEnvironment({
    createGround: false,
    createSkybox: false,
    environmentTexture: 'https://assets.babylonjs.com/environments/environmentSpecular.env',
  });

  // ── Материалы ──────────────────────────────────────────────────────────────
  const pc = PROFILE_COLORS[config.profileColor] ?? PROFILE_COLORS.inox;
  const profileMat = new PBRMaterial('profile', scene);
  profileMat.albedoColor = Color3.FromHexString(pc.hex);
  profileMat.metallic = pc.metal;
  profileMat.roughness = pc.roughness;
  profileMat.environmentIntensity = 0.6;
  profileMat.backFaceCulling = false; // рамка из лент — рендерим обе стороны

  const gc = GLASS_COLORS[config.glassColor] ?? GLASS_COLORS.clear;
  const gt = GLASS_TYPES[config.glassType] ?? GLASS_TYPES.smooth;
  const glassMat = new PBRMaterial('glass', scene);
  glassMat.albedoColor = Color3.FromHexString(gc.hex);
  glassMat.metallic = 0;
  glassMat.roughness = gt.roughness;
  glassMat.alpha = gt.alpha;
  glassMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  glassMat.backFaceCulling = false;
  glassMat.environmentIntensity = 0.5;

  // ── Сечение ──────────────────────────────────────────────────────────────
  const sec = parseSection(model.svgContent) ?? fallbackSection();
  buildMiteredFrame(scene, sec, W, H, profileMat);
  buildGlass(scene, sec, W, H, model.glassThickness || 4, glassMat);
  buildHinges(scene, sec, config, W, H, profileMat);

  return scene;
}

/** Зазор на 45°-стыке (мм): каждый торец отводится на половину от диагонали. */
const MITER_GAP = 0.5;

/**
 * Рамка фасада: профиль идёт по периметру, на углах — запилы 45°.
 * Каждая сторона — цельный меш: боковые стенки (контур сечения, протянутый
 * вдоль стороны) + два торца-крышки под 45°. Соседние стороны сходятся по
 * диагонали с зазором MITER_GAP.
 *
 * Локальные координаты сечения: p.x = s (поперёк фронта, 0..faceWidth),
 * p.y = d (глубина, 0..depth). Габарит рамы: x ∈ [-W/2, W/2], y ∈ [0, H].
 */
function buildMiteredFrame(scene: Scene, sec: Section3D, W: number, H: number, mat: PBRMaterial) {
  const g = MITER_GAP / 2;
  const V = (x: number, y: number, z: number) => new Vector3(x * MM, y * MM, z * MM);
  // Триангуляция торца — по исходному 2D-контуру сечения (s,d). Топология та
  // же при любом размещении кольца в 3D, поэтому считаем один раз.
  const tri = earcut(sec.outline.flatMap(p => [p.x, p.y]));

  // Угловые отображения (s,d) → мир. 45°-торец = X или Y зависят от s.
  // Зазор g сдвигает торец вдоль оси стороны прочь от угла.
  const BL = (s: number, d: number) => ({ x: -W / 2 + s, y: s,     d });  // низ-лево
  const BR = (s: number, d: number) => ({ x:  W / 2 - s, y: s,     d });  // низ-право
  const TL = (s: number, d: number) => ({ x: -W / 2 + s, y: H - s, d });  // верх-лево
  const TR = (s: number, d: number) => ({ x:  W / 2 - s, y: H - s, d });  // верх-право

  type Corner = (s: number, d: number) => { x: number; y: number; d: number };
  // Сторона: два кольца (торца) + сдвиг каждого вдоль оси на ±g.
  const side = (name: string, a: Corner, b: Corner, axis: 'x' | 'y') => {
    const ring = (c: Corner, sign: number) =>
      sec.outline.map(p => {
        const w = c(p.x, p.y);
        const x = axis === 'x' ? w.x + sign * g : w.x;
        const y = axis === 'y' ? w.y + sign * g : w.y;
        return V(x, y, w.d);
      });
    makeSide(scene, name, ring(a, +1), ring(b, -1), sec.outline.length, tri, mat);
  };

  side('frame-bottom', BL, BR, 'x');
  side('frame-top',    TL, TR, 'x');
  side('frame-left',   BL, TL, 'y');
  side('frame-right',  BR, TR, 'y');
}

/** Цельный меш стороны: стенки между двумя кольцами + 2 торца (готовые tri). */
function makeSide(scene: Scene, name: string, ringA: Vector3[], ringB: Vector3[], n: number, tri: number[], mat: PBRMaterial) {
  const positions: number[] = [];
  for (const p of ringA) positions.push(p.x, p.y, p.z);
  for (const p of ringB) positions.push(p.x, p.y, p.z);

  const indices: number[] = [];
  // Боковые стенки: квад между i-м ребром колец A и B
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = i, b = j, c = n + j, d = n + i;
    indices.push(a, b, c, a, c, d);
  }
  // Торцы (45°): та же триангуляция контура для обоих колец, B — реверс
  for (let k = 0; k < tri.length; k += 3) {
    indices.push(tri[k], tri[k + 1], tri[k + 2]);
    indices.push(n + tri[k + 2], n + tri[k + 1], n + tri[k]);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions; vd.indices = indices; vd.normals = normals;

  const m = new Mesh(name, scene);
  vd.applyToMesh(m);
  m.material = mat;
  return m;
}

function buildGlass(scene: Scene, sec: Section3D, W: number, H: number, thick: number, mat: PBRMaterial) {
  const fw = sec.faceWidth;
  const seat = sec.glassSeat;
  // Стекло = проём + нахлёст под профиль с каждой стороны
  const gw = (W - 2 * fw) + 2 * seat;
  const gh = (H - 2 * fw) + 2 * seat;
  const glass = MeshBuilder.CreateBox('glass', {
    width: gw * MM, height: gh * MM, depth: thick * MM,
  }, scene);
  glass.position.set(0, H / 2 * MM, sec.glassMid * MM);
  glass.material = mat;
}

function buildHinges(scene: Scene, sec: Section3D, config: FacadeConfig, W: number, H: number, mat: PBRMaterial) {
  if (config.hingeMode === 'none' || config.hingePositions.length === 0) return;
  const fw = sec.faceWidth;
  const dia = 35, cup = 12;  // присадка чашки петли
  const side = config.hingeSide;
  const backZ = (sec.depth - cup / 2) * MM;

  for (const pos of config.hingePositions) {
    const c = MeshBuilder.CreateCylinder('hinge', { diameter: dia * MM, height: cup * MM, tessellation: 24 }, scene);
    c.material = mat;
    c.rotation.x = Math.PI / 2;  // ось вдоль Z (глубина)
    let x = 0, y = 0;
    switch (side) {
      case 'left':   x = (-W / 2 + fw / 2) * MM;     y = pos * MM;            break;
      case 'right':  x = (W / 2 - fw / 2) * MM;       y = pos * MM;            break;
      case 'top':    x = (-W / 2 + pos) * MM;         y = (H - fw / 2) * MM;   break;
      case 'bottom': x = (-W / 2 + pos) * MM;         y = (fw / 2) * MM;       break;
    }
    c.position.set(x, y, backZ);
  }
}

/** Запасное прямоугольное сечение 44×20 если SVG не распарсился. */
function fallbackSection(): Section3D {
  return {
    outline: [ { x: 0, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 20 }, { x: 0, y: 20 } ],
    faceWidth: 44, depth: 20, glassMid: 13, glassSeat: 8,
  };
}
