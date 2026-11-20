import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface DemoScan {
  name: string;
  series: number;
  modality: string;
  description: string;
  dims: [number, number, number];
  spacing: [number, number, number];
  voxel_points: [number, number, number][];
  patient_points: [number, number, number][];
  corners: [number, number, number][];
  patient_to_reference: number[][];
}

export interface DemoData {
  reference_points_mm: [number, number, number][];
  labels: string[];
  scans: DemoScan[];
}

const SCAN_COLORS: Record<string, string> = {
  'MR-1': '#a3be8c',
  'MR-2': '#88c0d0',
  'MR-3': '#ebcb8b',
  'MR-4': '#c4a3c5',
  'CT-1': '#dc9099',
};

const PLAN_COLORS = ['#dc9099', '#d08770', '#ebcb8b', '#a3be8c', '#81a1c1'];

// DICOM patient LPS -> three.js. +z (superior) becomes +y (up); +y
// (posterior) becomes -z so anterior points at the camera.
const S = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);
const S_INV = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

const lp = (p: number[]) => new THREE.Vector3(p[0], p[2], -p[1]);

function rowMajor(m: number[][]): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    m[0][0], m[0][1], m[0][2], m[0][3],
    m[1][0], m[1][1], m[1][2], m[1][3],
    m[2][0], m[2][1], m[2][2], m[2][3],
    m[3][0], m[3][1], m[3][2], m[3][3],
  );
}

// corner bit order used by the generator: c*4 + r*2 + s
function boxEdges(): [number, number][] {
  const edges: [number, number][] = [];
  for (let a = 0; a < 8; a++) {
    for (let b = a + 1; b < 8; b++) {
      const d = (a ^ b).toString(2).split('1').length - 1;
      if (d === 1) edges.push([a, b]);
    }
  }
  return edges;
}
const EDGES = boxEdges();

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = 512 * scale;
  canvas.height = 128 * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(30,35,43,0.72)';
  ctx.beginPath();
  ctx.roundRect(6, 24, 500, 80, 14);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '600 44px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(180, 45, 1);
  return sprite;
}

// Wavy displacement so a smooth ellipsoid reads as a brain rather than a ball.
function displaceGyri(geo: THREE.BufferGeometry, amp = 0.07) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const bump =
      amp * Math.sin(6.5 * n.x + 0.7) * Math.sin(6.0 * n.y + 1.1) * Math.sin(7.0 * n.z) +
      amp * 0.55 * Math.sin(12.0 * n.x + 2.0) * Math.sin(10.0 * n.y) * Math.sin(11.0 * n.z + 0.5) +
      amp * 0.3 * Math.sin(19.0 * n.x) * Math.sin(17.0 * n.z + 1.3);
    v.copy(n).multiplyScalar(1 + bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// A little stylised brain in patient-LPS axes (superior up, anterior +z). Built
// once and cloned per scan; the returned materials are the shared instances the
// clones use, so they can be faded together.
function makeBrainPrototype() {
  const g = new THREE.Group();
  const materials: THREE.Material[] = [];

  const brainMat = new THREE.MeshStandardMaterial({
    color: 0xd98c8c, roughness: 0.92, metalness: 0,
    transparent: true, opacity: 0.72, depthWrite: false,
  });
  const deepMat = new THREE.MeshStandardMaterial({
    color: 0xc47f7f, roughness: 0.95, metalness: 0,
    transparent: true, opacity: 0.72, depthWrite: false,
  });
  materials.push(brainMat, deepMat);

  // two hemispheres, split on the midline
  [0, Math.PI].forEach((phi, i) => {
    const geo = new THREE.SphereGeometry(1, 40, 28, phi, Math.PI);
    geo.rotateY(Math.PI / 2);
    displaceGyri(geo);
    const m = new THREE.Mesh(geo, brainMat);
    m.scale.set(56, 44, 74);
    m.position.set(i === 0 ? 3 : -3, 10, -2);
    g.add(m);
  });

  // cerebellum + brainstem
  const cg = new THREE.SphereGeometry(1, 28, 20);
  displaceGyri(cg, 0.045);
  const cer = new THREE.Mesh(cg, deepMat);
  cer.scale.set(42, 26, 32);
  cer.position.set(0, -26, -44);
  g.add(cer);

  const stem = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 6, 12), deepMat);
  stem.scale.set(11, 26, 11);
  stem.position.set(0, -40, -18);
  stem.rotation.x = 0.35;
  g.add(stem);

  return { group: g, materials };
}

interface ScanObjects {
  group: THREE.Group;
  center: THREE.Vector3;
  targetCenter: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  offset: THREE.Vector3;
  label: THREE.Sprite;
  edgeMat: THREE.LineBasicMaterial;
  faceMat: THREE.MeshBasicMaterial;
  isRef: boolean;
}

export default function CoordFramesDemo({ data }: { data: DemoData }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  const targetRef = useRef(0);
  const animRef = useRef({ from: 0, start: 0, dur: 1400, active: false });
  const [registered, setRegistered] = useState(false);

  // Reference in the middle of the row; others keep their data order.
  const ordered = useMemo(() => {
    const ref = data.scans.find((s) => s.name === 'MR-1');
    const rest = data.scans.filter((s) => s.name !== 'MR-1');
    const mid = Math.floor(rest.length / 2);
    return [...rest.slice(0, mid), ref ?? rest[0], ...rest.slice(mid)].filter(
      Boolean,
    ) as DemoScan[];
  }, [data]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x09090b, 2200, 4200);

    const camera = new THREE.PerspectiveCamera(40, 1, 1, 8000);
    camera.position.set(120, 430, 1780);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 400;
    controls.maxDistance = 4500;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(400, 800, 900);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x60a5fa, 1.0);
    rim.position.set(-600, -300, -700);
    scene.add(rim);

    // faint reference grid in the axial plane
    const grid = new THREE.GridHelper(2200, 22, 0x27272a, 0x18181b);
    grid.position.y = -180;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    const scans: ScanObjects[] = [];
    const spacing = 300;

    // the reference anatomy every brain is placed against
    const refScan = ordered.find((s) => s.name === 'MR-1') ?? ordered[0];
    const refCorners = refScan.corners.map(lp);
    const refCenter = refCorners
      .reduce((a, c) => a.add(c), new THREE.Vector3())
      .multiplyScalar(1 / refCorners.length);
    const { group: brainProto, materials: brainMats } = makeBrainPrototype();

    ordered.forEach((scan, i) => {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      const color = new THREE.Color(SCAN_COLORS[scan.name] ?? '#9aa8bc');
      const isRef = scan.name === 'MR-1';

      const corners = scan.corners.map(lp);
      const center = corners
        .reduce((a, c) => a.add(c), new THREE.Vector3())
        .multiplyScalar(1 / corners.length);

      // translucent faces
      const facePos: number[] = [];
      const quads = [
        [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
        [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
      ];
      for (const q of quads) {
        for (const [a, b, c] of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
          for (const idx of [a, b, c]) {
            facePos.push(corners[idx].x, corners[idx].y, corners[idx].z);
          }
        }
      }
      const faceGeo = new THREE.BufferGeometry();
      faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(facePos, 3));
      faceGeo.computeVertexNormals();
      const faceMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: isRef ? 0.1 : 0.055,
        side: THREE.DoubleSide, depthWrite: false,
      });
      group.add(new THREE.Mesh(faceGeo, faceMat));
      const edgeMat = new THREE.LineBasicMaterial({
        color, transparent: true, opacity: isRef ? 0.95 : 0.6,
      });

      // edges
      const edgePos: number[] = [];
      for (const [a, b] of EDGES) {
        edgePos.push(corners[a].x, corners[a].y, corners[a].z);
        edgePos.push(corners[b].x, corners[b].y, corners[b].z);
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
      group.add(new THREE.LineSegments(edgeGeo, edgeMat));

      // biopsy points
      scan.patient_points.forEach((p, pi) => {
        const geo = new THREE.SphereGeometry(isRef ? 8 : 7, 20, 20);
        const mat = new THREE.MeshStandardMaterial({
          color: PLAN_COLORS[pi % PLAN_COLORS.length],
          emissive: PLAN_COLORS[pi % PLAN_COLORS.length],
          emissiveIntensity: 0.65,
          roughness: 0.35,
        });
        const sphere = new THREE.Mesh(geo, mat);
        sphere.position.copy(lp(p));
        group.add(sphere);
      });

      // registration transform in three space
      const m = S.clone().multiply(rowMajor(scan.patient_to_reference)).multiply(S_INV);
      const targetCenter = center.clone().applyMatrix4(m);
      const targetQuat = new THREE.Quaternion();
      m.decompose(new THREE.Vector3(), targetQuat, new THREE.Vector3());

      // a little brain, placed in this scan's own frame so registration carries
      // every copy onto the reference anatomy
      const mInv = m.clone().invert();
      const brain = brainProto.clone(true);
      brain.position.copy(refCenter.clone().applyMatrix4(mInv));
      mInv.decompose(new THREE.Vector3(), brain.quaternion, new THREE.Vector3());
      group.add(brain);

      const offset = new THREE.Vector3((i - (ordered.length - 1) / 2) * spacing, 0, 0);

      const label = makeLabelSprite(`${scan.name} · ${scan.description}`, SCAN_COLORS[scan.name] ?? '#9aa8bc');
      label.position.copy(center).add(new THREE.Vector3(0, 140, 0));
      group.add(label);

      scene.add(group);
      scans.push({ group, center, targetCenter, targetQuat, offset, label, edgeMat, faceMat, isRef });
    });

    // camera choreography: pull back for the exploded row, push in to the
    // reference box as the scans register
    const camFrom = new THREE.Vector3(120, 430, 1780);
    const camTo = refCenter.clone().add(new THREE.Vector3(80, 230, 620));
    const tgtFrom = new THREE.Vector3(0, 0, 0);
    const tgtTo = refCenter.clone();

    const dummy = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = animRef.current;
      const wasActive = a.active;
      if (a.active) {
        const u = Math.min(1, (performance.now() - a.start) / a.dur);
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        tRef.current = a.from + (targetRef.current - a.from) * e;
        if (u >= 1) a.active = false;
      }
      const ease = tRef.current;   // already eased by the animation curve

      // keep lerping on the final frame too, so the camera reaches its target
      if (wasActive) {
        camera.position.lerpVectors(camFrom, camTo, ease);
        controls.target.lerpVectors(tgtFrom, tgtTo, ease);
      }

      // fade the brains as they converge, so the points stay readable
      const brainFade = 1 - ease * 0.82;
      for (const bm of brainMats) {
        const base = (bm.userData.baseOpacity ??= bm.opacity) as number;
        bm.opacity = base * brainFade;
      }

      for (const s of scans) {
        const center = s.center.clone().add(s.offset.clone().multiplyScalar(1 - ease));
        center.lerp(s.targetCenter, ease);
        tmpQ.slerpQuaternions(new THREE.Quaternion(), s.targetQuat, ease);
        const m = new THREE.Matrix4().compose(center, tmpQ, dummy.set(1, 1, 1));
        m.multiply(new THREE.Matrix4().makeTranslation(-s.center.x, -s.center.y, -s.center.z));
        s.group.matrix.copy(m);
        s.group.matrixWorldNeedsUpdate = true;

        // fade the scaffolding as the scans converge, so the points read
        s.edgeMat.opacity = (s.isRef ? 0.95 : 0.6) * (1 - ease * 0.72);
        s.faceMat.opacity = (s.isRef ? 0.1 : 0.055) * (1 - ease * 0.5);
        (s.label.material as THREE.SpriteMaterial).opacity = s.isRef ? 1 : Math.max(0, 1 - ease * 1.6);
      }

      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const dispose = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    return dispose;
  }, [ordered]);

  const toggle = () => {
    const next = registered ? 0 : 1;
    animRef.current = { from: tRef.current, start: performance.now(), dur: 1400, active: true };
    targetRef.current = next;
    setRegistered(!registered);
  };

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-nord-800 bg-nord-950">
      <div ref={mountRef} className="w-full h-[420px] sm:h-[540px] cursor-grab active:cursor-grabbing" />

      <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-3 pointer-events-none">
        <div className="pointer-events-none">
          <div className="text-[10px] font-semibold tracking-wider text-frost-400 uppercase">
            Reference space · patient LPS
          </div>
          <div className="text-[11px] text-nord-400 mt-0.5">
            Superior up · anterior toward you · drag to orbit
          </div>
        </div>
        <button
          onClick={toggle}
          className={`pointer-events-auto shrink-0 px-4 py-2 rounded-full text-sm transition-colors ${
            registered
              ? 'bg-nord-950/75 backdrop-blur border border-nord-700/70 text-nord-200 font-medium hover:bg-nord-900 hover:text-white'
              : 'bg-frost-500 hover:bg-frost-400 text-nord-950 font-semibold shadow-[0_0_24px_-6px_rgba(136,192,208,0.6)]'
          }`}
        >
          {registered ? '↺ Reset' : 'Register all scans →'}
        </button>
      </div>

      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 pointer-events-none max-w-[70%]">
        {data.scans.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-nord-400">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SCAN_COLORS[s.name] }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="absolute bottom-3 right-3 flex gap-x-2 pointer-events-none">
        {data.labels.map((l, i) => (
          <span key={l} className="flex items-center gap-1 text-[10px] text-nord-500">
            <span className="w-2 h-2 rounded-full" style={{ background: PLAN_COLORS[i] }} />
            {l.replace('Plan ', 'P')}
          </span>
        ))}
      </div>
    </div>
  );
}
