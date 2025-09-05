
import React, { Suspense, useEffect, useState, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

function RoomModel({ url }: { url: string }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Group | null>(null);
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        sceneRef.current = gltf.scene;
        setScene(gltf.scene);
      },
      undefined,
      (error) => console.error("Error loading model:", error)
    );
    return () => {
      sceneRef.current?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const { material } = object;
          if (Array.isArray(material)) {
            material.forEach((mat) => mat.dispose());
          } else {
            material.dispose();
          }
        }
      });
      sceneRef.current = null;
    };
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
