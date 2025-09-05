
import React, { Suspense, useEffect, useState, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";

function RoomModel({
  url,
  onError,
}: {
  url: string;
  onError: (error: unknown) => void;
}) {
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
      (error) => {
        console.error("Error loading model:", error);
        onError(error);
      }
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
  }, [url, onError]);
  return scene ? <primitive object={scene} /> : null;
}

export default function ImportRoom({ id, apiUrl }: { id: string; apiUrl?: string }) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = apiUrl ?? process.env.REACT_APP_API_URL ?? "";
  useEffect(() => {
    if (baseUrl) {
      setFileUrl(`${baseUrl}/api/scans/${id}/room.glb`);
    }
  }, [id, baseUrl]);
  return (
    <div style={{ height: 600 }}>
      <Canvas camera={{ position: [2, 2, 2], fov: 50 }}>
        <ambientLight intensity={0.8} />
        <Suspense fallback={<div>Loading model…</div>}>
          {fileUrl && (
            <RoomModel
              url={fileUrl}
              onError={(err) =>
                setError(
                  err instanceof Error ? err.message : "Error loading model"
                )
              }
            />
          )}
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
      {error && <div style={{ color: "red" }}>{error}</div>}
    </div>
  );
}
