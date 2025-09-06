
import argparse
import os
import sys
import traceback

import addon_utils
import bpy


def enable(module):
    try:
        addon_utils.enable(module, default_set=True, persistent=True)
    except Exception as e:
        print(f"[WARN] Cannot enable addon {module}: {e}")


def err(msg, code=1):
    print("[ERROR]", msg)
    sys.exit(code)


parser = argparse.ArgumentParser(
    description="Convert a 3D file to GLB using Blender."
)
parser.add_argument("input", help="Input file path")
parser.add_argument("output", help="Output .glb file path")

try:
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
except (ValueError, SystemExit):
    err("Missing args. Use: ... -- INPUT OUTPUT.glb")

inp = args.input
out = args.output
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(inp)[1].lower()
try:
    if ext == ".obj":
        enable("io_scene_obj")
        try:
            bpy.ops.import_scene.obj(filepath=inp)
        except Exception:
            bpy.ops.wm.obj_import(filepath=inp)
    elif ext == ".ply":
        enable("io_mesh_ply")
        try:
            bpy.ops.import_mesh.ply(filepath=inp)
        except Exception:
            bpy.ops.wm.ply_import(filepath=inp)
    elif ext in (".usd", ".usda", ".usdz"):
        try:
            bpy.ops.wm.usd_import(filepath=inp)
        except Exception:
            try:
                bpy.ops.usd.import_(filepath=inp)
            except Exception as e:
                err(f"USD import failed: {e}", 2)
    else:
        err(f"Unsupported input extension: {ext}", 3)
except Exception as e:
    traceback.print_exc()
    err(f"Import failed: {e}", 4)
if not any(
    o.type in {"MESH", "CURVE", "EMPTY", "GPENCIL", "VOLUME"}
    for o in bpy.data.objects
):
    err("Scene empty after import", 5)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
try:
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
except Exception as e:
    traceback.print_exc()
    err(f"Export failed: {e}", 6)
print("[OK] Exported:", out)
sys.exit(0)
