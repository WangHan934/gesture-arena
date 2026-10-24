import bpy, json, hashlib, struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/models'
OUT.mkdir(parents=True,exist_ok=True)
# Run with Blender: blender --background art/blender/AISummoner_Monsters_Arena_v2_FireAnim.blend --python scripts/export_models.py
comparison={}

# Only exported derivatives change; never save over either source .blend.
rig=bpy.data.objects.get('InfernalHornbeast_Rig')
if rig and rig.animation_data:
 for track in rig.animation_data.nla_tracks: track.mute=True
 rig.animation_data.action=None
 for bone in rig.pose.bones:
  bone.location=(0,0,0);bone.rotation_quaternion=(1,0,0,0);bone.scale=(1,1,1)
bpy.context.scene.frame_set(1)
report={'source':str(Path(bpy.data.filepath).relative_to(ROOT)), 'user_mesh_geometry_matches':comparison, 'models':{}}
for group,filename in [('FireMonster','fire.glb'),('ShadowMonster','shadow.glb'),('RockMonster','rock.glb'),('Arena','arena.glb')]:
 bpy.ops.object.select_all(action='DESELECT')
 objects=list(bpy.data.collections[group].all_objects)
 for o in objects:
  o.hide_set(False);o.hide_viewport=False
  o.select_set(True)
 bpy.context.view_layer.objects.active=next((o for o in objects if o.type=='MESH'),None)
 result=bpy.ops.export_scene.gltf(
  filepath=str(OUT/filename),export_format='GLB',use_selection=True,
  export_animations=(group=='FireMonster'),export_animation_mode='ACTIONS',
  export_nla_strips=True,
  export_cameras=False,export_lights=False,export_extras=True,
  export_force_sampling=True,export_frame_range=False,export_apply=False,
 )
 if 'FINISHED' not in result: raise RuntimeError('Export failed: '+group)
 report['models'][filename]={'collection':group,'objects':len(objects),'bytes':(OUT/filename).stat().st_size,'sha256':hashlib.sha256((OUT/filename).read_bytes()).hexdigest()}
(OUT/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('EXPORT_REPORT',json.dumps(report,ensure_ascii=False))
