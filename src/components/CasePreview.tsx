import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IndexedMesh } from "../lib/mesh";
import type { GeneratedCase, MaterialId } from "../types";

interface CasePreviewProps {
  generated: GeneratedCase | null;
  material: MaterialId;
  view: "exterior" | "phone";
  stale?: boolean;
}

/**
 * The engine now hands over an indexed mesh, so the preview shares the exact
 * geometry that gets exported. Previously the preview re-triangulated JSCAD
 * polygons independently, which meant the render could look correct while the
 * exported file was broken.
 */
function toBufferGeometry(source: unknown): THREE.BufferGeometry {
  const mesh = source as IndexedMesh;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(Float32Array.from(mesh.positions), 3),
  );
  geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function previewMaterial(color: string, translucent: boolean, inlay: boolean) {
  if (inlay) {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.34,
      metalness: 0.05,
      clearcoat: 0.45,
      clearcoatRoughness: 0.25,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: translucent ? 0.18 : 0.4,
    metalness: 0.03,
    clearcoat: translucent ? 0.8 : 0.35,
    clearcoatRoughness: translucent ? 0.12 : 0.34,
    transmission: translucent ? 0.22 : 0,
    transparent: translucent,
    opacity: translucent ? 0.62 : 1,
    thickness: translucent ? 1.4 : 0,
    side: THREE.DoubleSide,
  });
}

export function CasePreview({ generated, material, view, stale }: CasePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !generated) return undefined;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x101410, 0.0028);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      34,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      1200,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(104, -144, 118);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.set(0, 0, 2);
    controls.minDistance = 85;
    controls.maxDistance = 380;

    scene.add(new THREE.HemisphereLight(0xe8fff7, 0x172018, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.6);
    key.position.set(-70, -60, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb8ff70, 2.3);
    rim.position.set(90, 80, 60);
    scene.add(rim);
    const fill = new THREE.PointLight(0x60d8bd, 22, 260);
    fill.position.set(-80, 40, 65);
    scene.add(fill);

    const group = new THREE.Group();
    group.rotation.y = view === "exterior" ? Math.PI : 0;
    generated.parts.forEach((part) => {
      const geometry = toBufferGeometry(part.geometry);
      const mesh = new THREE.Mesh(
        geometry,
        previewMaterial(
          part.color,
          material === "petg-translucent" && part.role === "shell",
          part.role === "inlay",
        ),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    scene.add(group);

    const grid = new THREE.GridHelper(250, 25, 0x3c4c3e, 0x273028);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -7;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((entry) => {
      entry.transparent = true;
      entry.opacity = 0.3;
    });
    scene.add(grid);

    let frame = 0;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resize = new ResizeObserver(() => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resize.observe(container);

    return () => {
      resize.disconnect();
      window.cancelAnimationFrame(frame);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const entries = Array.isArray(object.material) ? object.material : [object.material];
          entries.forEach((entry) => entry.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [generated, material, view]);

  return (
    <div className="case-preview" ref={containerRef}>
      {!generated && (
        <div className="preview-empty">
          <div className="preview-orbit" />
          <strong>Build the first geometry</strong>
          <span>The preview is generated from the selected phone record, not a stock render.</span>
        </div>
      )}
      {generated && (
        <div className="preview-hud">
          <span className={`live-dot ${stale ? "stale" : ""}`} />
          {stale ? "Draft changed · rebuild required" : `${generated.report.metrics.polygonCount?.toLocaleString()} polygons`}
        </div>
      )}
      <div className="preview-axis">
        <span>+Y top</span>
        <span>+X screen-right</span>
        <span>+Z screen</span>
      </div>
    </div>
  );
}
