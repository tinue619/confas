// Сборка 3D-фасада. Принимает готовую модель (положение профиля + параметры стекла)
// и пользовательские выборы (размеры, цвета, тип стекла).

import earcut from 'earcut';
import {
  Color3, Mesh, MeshBuilder, PBRMaterial, Scene, Vector3,
} from '@babylonjs/core';

import { parseSvgContour } from './svg-parser';
import { PROFILE_COLORS, GLASS_COLORS, GLASS_TYPES } from './catalog';
import { FacadeState } from './state';
import type { FacadeModel } from './model';

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

export function buildFacade(scene: Scene, fs: FacadeState, model: FacadeModel): Mesh {
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
  buildHingesAndDrillings(scene, model, fs, section, root);

  return root;
}

// ── Присадки (тёмные кружки) + петли (заглушка/.obj) ──────────────────────────
function buildHingesAndDrillings(
  scene: Scene, model: FacadeModel, fs: FacadeState,
  section: { x: number; y: number }[], root: Mesh,
) {
  if (fs.hingeMode === 'none' || !model.drilling) return;

  const W = fs.width, H = fs.height;
  const { diameter, edgeOffset } = model.drilling;
  const radius = diameter / 2;
  const maxSx  = Math.max(...section.map(p => p.x));
  const backZ  = -maxSx - 0.1; // чуть позади задней грани, чтобы не было z-fighting

  // Материал отверстия — почти чёрный, матовый
  const holeMat = new PBRMaterial('drill', scene);
  holeMat.albedoColor          = new Color3(0.04, 0.04, 0.04);
  holeMat.metallic             = 0;
  holeMat.roughness            = 0.9;
  holeMat.environmentIntensity = 0.05;

  // Материал заглушки петли (пока нет .obj)
  const stubMat = new PBRMaterial('hinge-stub', scene);
  stubMat.albedoColor          = new Color3(0.7, 0.7, 0.72);
  stubMat.metallic             = 0.85;
  stubMat.roughness            = 0.45;
  stubMat.environmentIntensity = 0.5;

  for (const [i, pos] of fs.hingePositions.entries()) {
    const clamped = Math.max(0, Math.min(
      (fs.hingeSide === 'left' || fs.hingeSide === 'right') ? H : W,
      pos,
    ));
    let cx = 0, cy = 0;
    switch (fs.hingeSide) {
      case 'left':   cx = edgeOffset;     cy = clamped;        break;
      case 'right':  cx = W - edgeOffset; cy = clamped;        break;
      case 'top':    cx = clamped;        cy = H - edgeOffset; break;
      case 'bottom': cx = clamped;        cy = edgeOffset;     break;
    }

    // Кружок присадки
    const disc = MeshBuilder.CreateDisc(`drill-${i}`, {
      radius, sideOrientation: Mesh.DOUBLESIDE,
    }, scene);
    disc.position.set(cx, cy, backZ);
    disc.material = holeMat;
    disc.parent   = root;

    // Петля — пока заглушка-цилиндр сзади (на месте .obj-модели)
    if (fs.hingeMode === 'holes+hinges') {
      const stub = MeshBuilder.CreateCylinder(`hinge-stub-${i}`, {
        diameter, height: model.drilling.depth + 8,
      }, scene);
      stub.rotation.x = Math.PI / 2; // ось чашки вдоль Z
      stub.position.set(cx, cy, backZ - (model.drilling.depth + 8) / 2);
      stub.material = stubMat;
      stub.parent   = root;
      // TODO: когда появится .obj — заменить заглушку на ImportMesh
    }
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
