"""
Rig the astronaut model and retarget CMU motion capture onto it (run with Blender 4.4+):

  Blender -b -P scripts/rig_astronaut.py -- <astronaut.obj> <walk.bvh> <run.bvh> <out.glb>

* Builds a humanoid armature at joints measured from the A-posed mesh and binds the suit
  with Blender's automatic (bone heat) weights.
* Imports CMU BVH clips (Carnegie Mellon University Motion Capture Database, mocap.cs.cmu.edu;
  BVH conversion by B. Hahne) and retargets them by bone *direction*: each frame every limb is
  turned to point where the matching mocap limb points, and the hips copy the mocap pelvis'
  full orientation. That works even though the CMU rest pose (T) differs from the mesh (A).
* Each clip is cut to one seamless gait cycle, made in-place, resampled to 30 fps and exported
  as an NLA track (glTF animation) named Walk / Run, plus a short breathing Idle.
"""
import json
import math
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OBJ, BVH_WALK, BVH_RUN, OUT = argv[:4]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ------------------------------------------------------------------ mesh
bpy.ops.wm.obj_import(filepath=OBJ, forward_axis='NEGATIVE_Z', up_axis='Y')
meshes = [o for o in scene.objects if o.type == 'MESH']


def B(v):
    """OBJ/model coordinates (Y up, facing +Z) -> Blender (Z up, facing -Y)."""
    x, y, z = v
    return Vector((x, -z, y))


# Joints measured from the mesh, model units (character's left = +X).
J = {
    'pelvis': (0, 1.45, -0.05), 'spine': (0, 1.78, -0.07), 'chest': (0, 2.15, -0.08), 'neck': (0, 2.55, -0.1),
    'head': (0, 2.72, -0.1), 'top': (0, 3.15, -0.08),
}


def side(sx):
    return {
        'hip': (sx * 0.2, 1.38, -0.06), 'knee': (sx * 0.22, 0.78, -0.08), 'ankle': (sx * 0.23, 0.2, -0.1), 'toe': (sx * 0.25, 0.04, 0.2),
        'clav': (sx * 0.1, 2.42, -0.1), 'shoulder': (sx * 0.42, 2.42, -0.1), 'elbow': (sx * 0.66, 1.95, -0.05),
        'wrist': (sx * 0.8, 1.55, -0.05), 'tip': (sx * 0.87, 1.26, -0.03),
    }


arm_data = bpy.data.armatures.new('Rig')
arm = bpy.data.objects.new('Astronaut', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, connect=False):
    b = eb.new(name)
    b.head, b.tail = B(head), B(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b


bone('Hips', J['pelvis'], J['spine'])
bone('Spine', J['spine'], J['chest'], 'Hips', True)
bone('Chest', J['chest'], J['neck'], 'Spine', True)
bone('Neck', J['neck'], J['head'], 'Chest', True)
bone('Head', J['head'], J['top'], 'Neck', True)
for sx, s in ((1, 'L'), (-1, 'R')):
    P = side(sx)
    bone(f'UpLeg.{s}', P['hip'], P['knee'], 'Hips')
    bone(f'Leg.{s}', P['knee'], P['ankle'], f'UpLeg.{s}', True)
    bone(f'Foot.{s}', P['ankle'], P['toe'], f'Leg.{s}', True)
    bone(f'Shoulder.{s}', P['clav'], P['shoulder'], 'Chest')
    bone(f'Arm.{s}', P['shoulder'], P['elbow'], f'Shoulder.{s}', True)
    bone(f'ForeArm.{s}', P['elbow'], P['wrist'], f'Arm.{s}', True)
    bone(f'Hand.{s}', P['wrist'], P['tip'], f'ForeArm.{s}', True)
bpy.ops.object.mode_set(mode='OBJECT')

# Bind with automatic weights (bone heat).
bpy.ops.object.select_all(action='DESELECT')
for m in meshes:
    m.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

# Rest-pose reference vectors of the target (armature space == world, object is identity).
rest = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm_data.bones}
tgt_leg = (rest['UpLeg.L'][0] - rest['Leg.L'][0]).length + (rest['Leg.L'][0] - rest['Foot.L'][0]).length

MAP = {  # target bone -> (source joint, source joint the bone points to)
    'Spine': ('LowerBack', 'Spine1'), 'Chest': ('Spine1', 'Neck'), 'Neck': ('Neck', 'Head'), 'Head': ('Head', 'Head:tail'),
}
for s, S in (('L', 'Left'), ('R', 'Right')):
    MAP.update({
        f'UpLeg.{s}': (f'{S}UpLeg', f'{S}Leg'), f'Leg.{s}': (f'{S}Leg', f'{S}Foot'), f'Foot.{s}': (f'{S}Foot', f'{S}ToeBase'),
        f'Shoulder.{s}': (f'{S}Shoulder', f'{S}Arm'), f'Arm.{s}': (f'{S}Arm', f'{S}ForeArm'),
        f'ForeArm.{s}': (f'{S}ForeArm', f'{S}Hand'), f'Hand.{s}': (f'{S}Hand', f'{S}HandIndex1'),
    })
ORDER = ['Hips', 'Spine', 'Chest', 'Neck', 'Head'] + [f'{b}.{s}' for s in 'LR' for b in ('UpLeg', 'Leg', 'Foot', 'Shoulder', 'Arm', 'ForeArm', 'Hand')]


def basis(right, up):
    r = right.normalized()
    u = (up - r * up.dot(r)).normalized()
    f = u.cross(r)
    return Matrix((r, u, f)).transposed()


def snapshot():
    return {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones}


def bake(name, poses, frames, key_location=('Hips',)):
    """Key precomputed poses into a new action and push it to its own NLA track.

    Poses are computed with no action or NLA active (otherwise Blender re-applies the earlier
    clips while a new one is being posed). The last pose of a loop is the first pose copied, and
    quaternions are kept in one hemisphere, so every clip loops without a jump.
    """
    ad = arm.animation_data
    action = bpy.data.actions.new(name)
    ad.action = action
    prev = {}
    for pose, kf in zip(poses, frames):
        for pb in arm.pose.bones:
            q, loc = pose[pb.name]
            q = q.copy()
            if pb.name in prev and q.dot(prev[pb.name]) < 0:
                q.negate()
            prev[pb.name] = q
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert('rotation_quaternion', frame=kf)
            if pb.name in key_location:
                pb.keyframe_insert('location', frame=kf)
    track = ad.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    ad.action = None


def retarget(bvh_path, name, max_cycle_s):
    before = set(scene.objects)
    bpy.ops.import_anim.bvh(filepath=bvh_path, axis_forward='-Z', axis_up='Y', rotate_mode='NATIVE', update_scene_fps=False, update_scene_duration=False, use_fps_scale=False)
    src = next(o for o in scene.objects if o not in before and o.type == 'ARMATURE')
    act = src.animation_data.action
    f0, f1 = (int(x) for x in act.frame_range)

    def joints(f):
        scene.frame_set(f)
        mw = src.matrix_world
        d = {pb.name: mw @ pb.head for pb in src.pose.bones}
        d.update({f'{pb.name}:tail': mw @ pb.tail for pb in src.pose.bones})
        return d

    frames = {f: joints(f) for f in range(f0, f1 + 1)}
    # Heading: rotate so the subject walks toward the model's front (-Y in Blender).
    travel = frames[f1]['Hips'] - frames[f0]['Hips']
    travel.z = 0
    yaw = math.atan2(travel.x, travel.y) - math.atan2(0, -1)
    align = Matrix.Rotation(yaw, 3, 'Z')  # turns the walking direction onto -Y
    src_leg = (frames[f0]['LeftUpLeg'] - frames[f0]['LeftLeg']).length + (frames[f0]['LeftLeg'] - frames[f0]['LeftFoot']).length
    k = tgt_leg / src_leg

    # Find the most seamless single gait cycle (pose relative to the hips).
    keys = ['LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'LeftLeg', 'RightLeg']

    def pose_vec(f):
        h = frames[f]['Hips']
        return [align @ (frames[f][j] - h) for j in keys]

    fps_src = 120  # CMU BVH frame time 1/120 s
    best = (1e9, f0, f1)
    lo, hi = int(0.55 * fps_src), int(max_cycle_s * fps_src)
    for i in range(f0, f1 - lo):
        a = pose_vec(i)
        for j in range(i + lo, min(f1, i + hi)):
            b = pose_vec(j)
            d = sum((x - y).length for x, y in zip(a, b))
            if d < best[0]:
                best = (d, i, j)
    _, ci, cj = best
    cycle_s = (cj - ci) / fps_src
    stride = ((frames[cj]['Hips'] - frames[ci]['Hips']) * k)
    stride.z = 0
    hips_z = sum(frames[f]['Hips'].z for f in range(ci, cj)) / (cj - ci)

    # Target rest basis for the hips.
    t_right = rest['UpLeg.L'][0] - rest['UpLeg.R'][0]
    t_up = rest['Spine'][1] - rest['Hips'][0]
    t_basis = basis(t_right, t_up)
    hips_rest_rot = arm_data.bones['Hips'].matrix_local.to_3x3()

    arm.animation_data_create()
    arm.animation_data.action = None
    arm.animation_data.use_nla = False   # don't let earlier clips re-pose the rig while we work
    n = max(2, round(cycle_s * 30))
    poses = []
    for kf in range(n):
        fsrc = ci + (cj - ci) * (kf % n) / n
        fi = int(round(fsrc))
        fr = frames[min(max(fi, f0), f1)]
        # reset pose
        for pb in arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        # Hips: full orientation from the mocap pelvis, in place, with the vertical bob.
        s_basis = basis(align @ (fr['LeftUpLeg'] - fr['RightUpLeg']), align @ (fr['Spine1'] - fr['Hips']))
        rot = s_basis @ t_basis.transposed() @ hips_rest_rot
        loc = rest['Hips'][0] + Vector((0, 0, (fr['Hips'].z - hips_z) * k))
        pb = arm.pose.bones['Hips']
        pb.matrix = Matrix.LocRotScale(loc, rot.to_quaternion(), None)
        bpy.context.view_layer.update()
        for bn in ORDER[1:]:
            a, b = MAP[bn]
            want = align @ (fr[b] - fr[a])
            if want.length < 1e-6:
                continue
            pb = arm.pose.bones[bn]
            mw = pb.matrix.copy()
            cur = (mw.to_3x3() @ Vector((0, 1, 0))).normalized()
            q = cur.rotation_difference(want.normalized())
            pb.matrix = Matrix.LocRotScale(mw.translation, (q @ mw.to_quaternion()), None)
            bpy.context.view_layer.update()
        poses.append(snapshot())
    bake(name, poses + [poses[0]], list(range(n + 1)))
    bpy.data.objects.remove(src, do_unlink=True)
    return {'cycleSeconds': n / 30, 'strideMetersModel': stride.length, 'speedModelPerS': stride.length / (n / 30)}


meta = {'walk': retarget(BVH_WALK, 'Walk', 1.6), 'run': retarget(BVH_RUN, 'Run', 1.1)}

# Idle: a relaxed standing pose (arms hanging, elbows soft, weight settled) with a slow
# breath. Bones are aimed at world directions, like the retarget, so the A-pose rest of the
# mesh doesn't matter. Blender frame: Z up, the astronaut faces -Y, its left is +X.
def aim(bn, direction):
    pb = arm.pose.bones[bn]
    mw = pb.matrix.copy()
    cur = (mw.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(Vector(direction).normalized())
    pb.matrix = Matrix.LocRotScale(mw.translation, q @ mw.to_quaternion(), None)
    bpy.context.view_layer.update()


arm.animation_data.action = None
arm.animation_data.use_nla = False


def idle_pose(breath):
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    # Breathing: the chest lifts and opens, the head rides with it.
    arm.pose.bones['Spine'].rotation_quaternion = Matrix.Rotation(0.012 * breath, 4, 'X').to_quaternion()
    arm.pose.bones['Chest'].rotation_quaternion = Matrix.Rotation(0.03 * breath, 4, 'X').to_quaternion()
    arm.pose.bones['Head'].rotation_quaternion = Matrix.Rotation(-0.03 * breath, 4, 'X').to_quaternion()
    bpy.context.view_layer.update()
    for s_, sx in (('L', 1), ('R', -1)):
        # Shoulders rise a touch on the in-breath; arms hang just clear of the suit.
        aim(f'Shoulder.{s_}', (sx * 1.0, 0.0, 0.03 + 0.04 * breath))
        aim(f'Arm.{s_}', (sx * 0.2, -0.04, -1.0))
        aim(f'ForeArm.{s_}', (sx * 0.1, -0.32, -1.0))
        aim(f'Hand.{s_}', (sx * 0.06, -0.25, -1.0))
        # Legs straight under the hips, feet a little apart, toes slightly out.
        aim(f'UpLeg.{s_}', (sx * 0.035, 0.0, -1.0))
        aim(f'Leg.{s_}', (sx * 0.01, 0.02, -1.0))
        aim(f'Foot.{s_}', (sx * 0.18, -1.0, -0.35))
    return snapshot()


# 4 s breathing cycle at 30 fps: in for ~1.6 s, out for ~2.4 s; ends exactly where it starts.
rest_pose, full_breath = idle_pose(0.0), idle_pose(1.0)
bake('Idle', [rest_pose, full_breath, rest_pose], [0, 48, 120], key_location=())
arm.animation_data.use_nla = True
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)

bpy.ops.object.select_all(action='DESELECT')
for m in meshes:
    m.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True, export_yup=True, export_apply=False)
with open(OUT.replace('.glb', '.json'), 'w') as f:
    json.dump(meta, f, indent=1)
print('RIG_OK', json.dumps(meta))
