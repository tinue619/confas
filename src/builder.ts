// Сборка 3D-фасада. Принимает готовую модель (положение профиля + параметры стекла)
// и пользовательские выборы (размеры, цвета, тип стекла).

import earcut from 'earcut';
import {
  Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, Scene, SceneLoader, Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/OBJ';

import { parseSvgContour } from './svg-parser';
import { PROFILE_COLORS, GLASS_COLORS, GLASS_TYPES } from './catalog';
import { FacadeState, type HingeSide } from './state';
import type { FacadeModel } from './model';

// Кэш загруженных .obj-петель: url → mesh-шаблон (disabled, не рендерится напрямую)
const hingeTemplateCache = new Map<string, Mesh>();
const hingeLoading = new Map<string, Promise<Mesh | null>>();

async function loadHingeTemplate(scene: Scene, url: string): Promise<Mesh | null> {
  if (hingeTemplateCache.has(url)) return hingeTemplateCache.get(url)!;
  if (hingeLoading.has(url))       return hingeLoading.get(url)!;

  const slash = url.lastIndexOf('/');
  const rootUrl = url.substring(0, slash + 1);
  const file    = url.substring(slash + 1);

  const promise = SceneLoader.ImportMeshAsync('', rootUrl, file, scene)
    .then(result => {
      const real = result.meshes.filter(m => m instanceof Mesh && m.getTotalVertices() > 0) as Mesh[];
      if (real.length === 0) return null;
      const merged = real.length === 1
        ? real[0]
        : Mesh.MergeMeshes(real, true, true, undefined, false, true);
      if (!merged) return null;
      // Центрируем по bounding box, чтобы клоны позиционировались за центр
      const bb = merged.getBoundingInfo().boundingBox;
      const c  = bb.center;
      merged.bakeTransformIntoVertices(Matrix.Translation(-c.x, -c.y, -c.z));
      merged.setEnabled(false);
      merged.name = 'hinge-template';
      hingeTemplateCache.set(url, merged);
      return merged;
    })
    .catch(err => {
      console.error('Hinge load failed:', url, err);
      return null;
    })
    .finally(() => hingeLoading.delete(url));

  hingeLoading.set(url, promise);
  return promise;
}

// ── Рифление: профиль волны (период 14 мм) ────────────────────────────────────
const RIB_PERIOD = 14;
const RIB_SECTION: { x: number; z: number }[] = [
  { x: 0,      z: 4.000 },
  { x: 2.255,  z: 3.172 },
  { x: 4.604,  z: 2.669 },
  { x: 7.000,  z: 2.500 },
  { x: 9.396,  z: 2.669 },
  { x: 11.745, z: 3.172 },
];
const RIB_Z_CENTER = (4.0 + 2.5) / 2;

(window as any).earcut = earcut;

export function buildFacade(scene: Scene, fs: FacadeState, model: FacadeModel,
  onAsyncReady?: () => void): Mesh {
  const root = new Mesh('facade', scene);

  const section = getTransformedSection(model);
  if (section.length < 3) return root;

  // ── Материалы ──────────────────────────────────────────────────────────────
  const pc = PROFILE_COLORS[fs.profileColor];
  const frameMat = new PBRMaterial('frame', scene);
  frameMat.albedoColor          = Color3.FromHexString(pc.hex);
  frameMat.metallic             = pc.metal;
  frameMat.roughness            = pc.roughness;
  frameMat.environmentIntensity = 0.45;

  const gc = GLASS_COLORS[fs.glassColor];
  const gt = GLASS_TYPES[fs.glassType];
  const glassMat = new PBRMaterial('glass', scene);
  glassMat.albedoColor          = Color3.FromHexString(gc.hex);
  glassMat.metallic             = 0;
  glassMat.roughness            = gt.roughness;
  glassMat.alpha                = gt.alpha;
  glassMat.transparencyMode     = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  glassMat.backFaceCulling      = false;
  glassMat.environmentIntensity = 0.5;

  const W = fs.width, H = fs.height;
  const t = model.glassThickness;
  const frameVis = Math.max(0, -model.glassEdgeY);

  // ── Стекло ─────────────────────────────────────────────────────────────────
  const gW = Math.max(1, W - 2 * frameVis);
  const gH = Math.max(1, H - 2 * frameVis);
  const glassX = frameVis;
  const glassY = frameVis;
  const centerZ = 0;

  for (const m of buildGlass(scene, fs.glassType, gW, gH, glassX, glassY, centerZ, t)) {
    m.material = glassMat;
    m.parent   = root;
  }

  // ── Рамка: 4 стороны через ExtrudePolygon ─────────────────────────────────
  {
    const shape = section.map(p => new Vector3(-p.y, 0, -p.x));
    const m = MeshBuilder.ExtrudePolygon('bottom', {
      shape, depth: W, sideOrientation: Mesh.DOUBLESIDE,
    }, scene, earcut);
    m.rotation.z = Math.PI / 2;
    m.position.set(0, 0, 0);
    m.material = frameMat;
    m.parent = root;
  }
  {
    const shape = section.map(p => new Vector3(-p.y, 0, -p.x));
    const m = MeshBuilder.ExtrudePolygon('top', {
      shape, depth: W, sideOrientation: Mesh.DOUBLESIDE,
    }, scene, earcut);
    m.rotation.z = -Math.PI / 2;
    m.position.set(W, H, 0);
    m.material = frameMat;
    m.parent = root;
  }
  {
    const shape = section.map(p => new Vector3(-p.y, 0, -p.x));
    const m = MeshBuilder.ExtrudePolygon('left', {
      shape, depth: H, sideOrientation: Mesh.DOUBLESIDE,
    }, scene, earcut);
    m.position.set(0, H, 0);
    m.material = frameMat;
    m.parent = root;
  }
  {
    const shape = section.map(p => new Vector3(p.y, 0, -p.x));
    const m = MeshBuilder.ExtrudePolygon('right', {
      shape, depth: H, sideOrientation: Mesh.DOUBLESIDE,
    }, scene, earcut);
    m.position.set(W, H, 0);
    m.material = frameMat;
    m.parent = root;
  }

  // ── Присадки + петли ──────────────────────────────────────────────────────
  buildHingesAndDrillings(scene, model, fs, section, root, onAsyncReady);

  return root;
}

// ── Присадки (тёмные кружки) + петли (клоны .obj) ────────────────────────────
function buildHingesAndDrillings(
  scene: Scene, model: FacadeModel, fs: FacadeState,
  section: { x: number; y: number }[], root: Mesh,
  onAsyncReady?: () => void,
) {
  if (fs.hingeMode === 'none' || !model.drilling) return;

  const W = fs.width, H = fs.height;
  const { diameter, edgeOffset } = model.drilling;
  const radius = diameter / 2;
  const maxSx  = Math.max(...section.map(p => p.x));
  const backZ  = -maxSx - 0.1;

  const holeMat = new PBRMaterial('drill', scene);
  holeMat.albedoColor          = new Color3(0.04, 0.04, 0.04);
  holeMat.metallic             = 0;
  holeMat.roughness            = 0.9;
  holeMat.environmentIntensity = 0.05;

  // ── Загрузка/доступ к шаблону петли ──────────────────────────────────────
  const needHinges = fs.hingeMode === 'holes+hinges' && !!model.hinges?.objFile;
  let template: Mesh | null = null;
  if (needHinges) {
    const url = model.hinges!.objFile;
    if (hingeTemplateCache.has(url)) {
      template = hingeTemplateCache.get(url)!;
    } else {
      // Асинхронная загрузка — после загрузки запросим перестройку
      loadHingeTemplate(scene, url).then(loaded => {
        if (loaded && onAsyncReady) onAsyncReady();
      });
    }
  }

  // Запасной серебристый материал (если у клона .obj нет своего)
  const stubMat = new PBRMaterial('hinge-stub', scene);
  stubMat.albedoColor          = new Color3(0.72, 0.72, 0.75);
  stubMat.metallic             = 0.6;
  stubMat.roughness            = 0.5;
  stubMat.environmentIntensity = 0.5;

  for (const [i, pos] of fs.hingePositions.entries()) {
    const sideLen = (fs.hingeSide === 'left' || fs.hingeSide === 'right') ? H : W;
    const clamped = Math.max(0, Math.min(sideLen, pos));
    let cx = 0, cy = 0;
    switch (fs.hingeSide) {
      case 'left':   cx = edgeOffset;     cy = clamped;        break;
      case 'right':  cx = W - edgeOffset; cy = clamped;        break;
      case 'top':    cx = clamped;        cy = H - edgeOffset; break;
      case 'bottom': cx = clamped;        cy = edgeOffset;     break;
    }

    // Тёмный кружок присадки
    const disc = MeshBuilder.CreateDisc(`drill-${i}`, {
      radius, sideOrientation: Mesh.DOUBLESIDE,
    }, scene);
    disc.position.set(cx, cy, backZ);
    disc.material = holeMat;
    disc.parent   = root;

    // Петля .obj — клонируем шаблон в точку присадки
    if (fs.hingeMode === 'holes+hinges') {
      if (template) {
        const clone = template.clone(`hinge-${i}`, root, false);
        if (clone) {
          clone.setEnabled(true);
          clone.position.set(cx, cy, backZ);
          // Поворот: чашка должна "входить" в отверстие со стороны выбранной грани
          clone.rotation = hingeRotation(fs.hingeSide);
          if (!clone.material) clone.material = stubMat;
        }
      } else {
        // Пока .obj не загрузился — лёгкий цилиндр-плейсхолдер
        const stub = MeshBuilder.CreateCylinder(`hinge-stub-${i}`, {
          diameter, height: model.drilling.depth + 8,
        }, scene);
        stub.rotation.x = Math.PI / 2;
        stub.position.set(cx, cy, backZ - (model.drilling.depth + 8) / 2);
        stub.material = stubMat;
        stub.parent   = root;
      }
    }
  }
}

// Поворот клонированной петли в зависимости от стороны фасада.
// .obj экспортирован в некотором "родном" пространстве — конкретные углы
// подкручиваются эмпирически после первого просмотра.
function hingeRotation(side: HingeSide): Vector3 {
  switch (side) {
    case 'left':   return new Vector3(0, 0, 0);
    case 'right':  return new Vector3(0, Math.PI, 0);
    case 'top':    return new Vector3(0, 0, -Math.PI / 2);
    case 'bottom': return new Vector3(0, 0,  Math.PI / 2);
  }
}

// ── Стекло: гладкое / матовое / рифлёное ──────────────────────────────────────
function buildGlass(
  scene: Scene,
  type: 'smooth' | 'matte' | 'textured',
  gW: number, gH: number, x0: number, y0: number, centerZ: number, t: number,
): Mesh[] {
  if (type !== 'textured') {
    const m = MeshBuilder.CreateBox('glass', { width: gW, height: gH, depth: t }, scene);
    m.position.set(x0 + gW / 2, y0 + gH / 2, centerZ);
    return [m];
  }

  const toWorldZ = (pz: number) => centerZ + (pz - RIB_Z_CENTER);
  const topPath:    Vector3[] = [];
  const bottomPath: Vector3[] = [];

  let periodStart = 0;
  while (periodStart < gW) {
    for (const p of RIB_SECTION) {
      const lx = periodStart + p.x;
      if (lx > gW) break;
      const wz = toWorldZ(p.z);
      topPath.push(   new Vector3(x0 + lx, y0 + gH, wz));
      bottomPath.push(new Vector3(x0 + lx, y0,       wz));
    }
    periodStart += RIB_PERIOD;
  }
  const phaseX = gW - (periodStart - RIB_PERIOD);
  const edgeZ  = toWorldZ(interpRibZ(phaseX));
  topPath.push(   new Vector3(x0 + gW, y0 + gH, edgeZ));
  bottomPath.push(new Vector3(x0 + gW, y0,       edgeZ));

  const ribbon = MeshBuilder.CreateRibbon('glass-rib', {
    pathArray: [topPath, bottomPath],
    sideOrientation: Mesh.DOUBLESIDE,
  }, scene);

  const backZ = centerZ - RIB_Z_CENTER;
  const back = MeshBuilder.CreatePlane('glass-back', {
    width: gW, height: gH, sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  back.position.set(x0 + gW / 2, y0 + gH / 2, backZ);

  return [ribbon, back];
}

function interpRibZ(xInPeriod: number): number {
  const pts = [...RIB_SECTION, { x: RIB_PERIOD, z: RIB_SECTION[0].z }];
  for (let i = 0; i < pts.length - 1; i++) {
    if (xInPeriod >= pts[i].x && xInPeriod <= pts[i + 1].x) {
      const t = (xInPeriod - pts[i].x) / (pts[i + 1].x - pts[i].x);
      return pts[i].z + t * (pts[i + 1].z - pts[i].z);
    }
  }
  return RIB_SECTION[0].z;
}

// ── Сечение из модели: парсим svgContent + поворот/смещение ───────────────────
function getTransformedSection(model: FacadeModel) {
  const raw = parseSvgContour(model.svgContent);
  const r = model.rotation;
  const c = Math.cos(r * Math.PI / 180);
  const s = Math.sin(r * Math.PI / 180);
  const ox = model.offset.x, oy = model.offset.y;
  return raw.map(p => ({ x: p.x * c - p.y * s + ox, y: p.x * s + p.y * c + oy }));
}
