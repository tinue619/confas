import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, Mesh, DefaultRenderingPipeline, Matrix,
} from '@babylonjs/core';
import { FacadeState } from './state';
import type { FacadeModel } from './model';
import { buildFacade } from './builder';
import { createDimensionsOverlay } from './dimensions';

export function createScene(canvas: HTMLCanvasElement, fs: FacadeState, model: FacadeModel) {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true, stencil: true,
    antialias: true, adaptToDeviceRatio: true,
  });
  engine.setHardwareScalingLevel(1 / (window.devicePixelRatio || 1));

  const scene = new Scene(engine);
  // HDR-белый: значения > 1 после ACES маппинга станут чистым 255
  scene.clearColor = new Color4(1.6, 1.6, 1.6, 1);

  const camera = new ArcRotateCamera(
    'cam', Math.PI / 2, Math.PI / 2.4, 2800,
    new Vector3(0, 400, 0), scene,
  );
  // false = preventDefault на событиях → браузер не перехватывает LMB
  camera.attachControl(canvas, false);
  camera.wheelDeltaPercentage = 0.02;
  camera.panningSensibility   = 3;
  camera.angularSensibilityX  = 1000;
  camera.angularSensibilityY  = 1000;
  camera.pinchPrecision       = 50;
  camera.inertia        = 0.85;
  camera.panningInertia = 0.85;
  camera.minZ = 1;
  camera.maxZ = 50000;

  // Общий ambient (рассеянный) — поднял, чтобы тени не были чёрными
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.7;
  hemi.groundColor = new Color3(0.35, 0.35, 0.38);

  // Главный направленный — сверху-справа-спереди
  const dir = new DirectionalLight('dir', new Vector3(-1, -1, -1), scene);
  dir.intensity = 1.8;
  dir.position = new Vector3(3000, 2000, 3000);

  // Заполняющий — с фронта, чтобы лицевая сторона не была тёмной
  const dirFront = new DirectionalLight('dir-front', new Vector3(0, -0.3, -1), scene);
  dirFront.intensity = 0.9;

  // Боковой подсвет
  const dirSide = new DirectionalLight('dir-side', new Vector3(1, -0.2, 0.3), scene);
  dirSide.intensity = 0.5;

  scene.createDefaultEnvironment({
    createGround: false,
    createSkybox: false,
    environmentTexture: 'https://assets.babylonjs.com/environments/environmentSpecular.env',
  });

  const pipeline = new DefaultRenderingPipeline('aa', true, scene, [camera]);
  pipeline.samples = 4;
  pipeline.fxaaEnabled = true;
  // Тон-маппинг ACES — оставляем, чтобы блики не вылетали в чистый белый.
  // Фон сделан HDR (>1), поэтому после ACES он всё равно станет белым.
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.exposure = 1.0;

  let root: Mesh | null = null;

  const rebuild = () => {
    if (root) root.dispose(false, true);
    root = buildFacade(scene, fs, model, () => rebuild());
    root.position.set(-fs.width / 2, 0, 0);
    camera.target = new Vector3(0, fs.height / 2, 0);
    const diag = Math.hypot(fs.width, fs.height);
    camera.radius = Math.max(diag * 1.3, 300);
    camera.lowerRadiusLimit = Math.max(50, diag * 0.2);
    camera.upperRadiusLimit = diag * 6;
  };

  // ── CAD-стиль размеры (SVG-оверлей поверх canvas) ─────────────────────────
  const dim = createDimensionsOverlay(canvas);
  scene.onBeforeRenderObservable.add(() => {
    const W = fs.width, H = fs.height;
    // Углы фасада в мировых координатах (root спозиционирован на -W/2, 0)
    // Берём передние углы (z небольшой положительный — край профиля)
    const z = 4;
    const corners = {
      bl: project(new Vector3(-W / 2, 0, z), scene, engine, camera),
      br: project(new Vector3( W / 2, 0, z), scene, engine, camera),
      tl: project(new Vector3(-W / 2, H, z), scene, engine, camera),
    };
    dim.update(W, H, corners);
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());

  // Авто-ресайз при изменении размера canvas (например, разворачивание панели)
  const ro = new ResizeObserver(() => engine.resize());
  ro.observe(canvas);

  return { engine, scene, rebuild };
}

function project(v: Vector3, scene: Scene, engine: Engine, camera: ArcRotateCamera) {
  const p = Vector3.Project(
    v,
    Matrix.Identity(),
    scene.getTransformMatrix(),
    camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
  );
  // Vector3.Project возвращает в координатах рендер-буфера (с учётом DPR).
  // Делим на DPR чтобы получить CSS-пиксели для оверлея.
  const dpr = window.devicePixelRatio || 1;
  return { x: p.x / dpr, y: p.y / dpr };
}
