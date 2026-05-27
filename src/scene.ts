import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, Mesh, DefaultRenderingPipeline,
} from '@babylonjs/core';
import { FacadeState } from './state';
import type { FacadeModel } from './model';
import { buildFacade } from './builder';
import { DimensionsManager } from './dimensions';

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
  const dim = new DimensionsManager(scene, canvas);

  const rebuild = () => {
    if (root) root.dispose(false, true);
    root = buildFacade(scene, fs, model, () => rebuild());
    root.position.set(-fs.width / 2, 0, 0);
    camera.target = new Vector3(0, fs.height / 2, 0);
    const diag = Math.hypot(fs.width, fs.height);
    camera.radius = Math.max(diag * 1.3, 300);
    camera.lowerRadiusLimit = Math.max(50, diag * 0.2);
    camera.upperRadiusLimit = diag * 6;
    dim.rebuild(fs);
  };

  // Каждый кадр — проецируем якоря размеров и обновляем подписи
  scene.onBeforeRenderObservable.add(() => dim.updateOverlay(camera, engine));

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());

  // Авто-ресайз при изменении размера canvas (например, разворачивание панели)
  const ro = new ResizeObserver(() => engine.resize());
  ro.observe(canvas);

  return { engine, scene, rebuild };
}
