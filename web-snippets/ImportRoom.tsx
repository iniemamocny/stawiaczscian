
import React, { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

function RoomModel({ url }: { url: string }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => setScene(gltf.scene));
  }, [url]);
  return scene ? <primitive object={scene} /> : null;
}

export default function ImportRoom({ id }: { id: string }) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => { setFileUrl(`http://localhost:4000/api/scans/${id}/room.glb`); }, [id]);
  return (
    <div style={{ height: 600 }}>
      <Canvas camera={{ position: [2, 2, 2], fov: 50 }}>
        <ambientLight intensity={0.8} />
        <Suspense fallback={null}>{fileUrl && <RoomModel url={fileUrl} />}</Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}
