"""Generates the two synthetic ONNX fixtures used by P7B-01's browser test.

Both fixtures use the REAL production I/O shapes documented in
`docs/decisions/weight-mirrors.md`, but carry no learned weights: each graph
is Reshape -> Tile -> Mul-by-scalar-constant, so the only "weight" is a single
float32 scalar per output branch. This keeps the .onnx files a few KB instead
of the 174-285 MB real pinned models, while still exercising a real
`onnxruntime-web` `InferenceSession` end to end (session creation, real input
tensors, real output tensors, deterministic numeric values).

Rock-shaped fixture (`rock-synthetic.onnx`):
  input  mix   float32 [1, 2, 343980]
  output stems float32 [1, 6, 2, 343980]  (mix tiled 6x on a new stem axis, x2)

Basic-shaped fixture (`basic-synthetic.onnx`):
  inputs  mix float32 [1, 2, 343980], mag float32 [1, 4, 2048, 336]
  outputs freq float32 [1, 4, 4, 2048, 336] (mag tiled 4x on a new branch axis, x3)
          time float32 [1, 4, 2, 343980]    (mix tiled 4x on a new branch axis, x5)

Environment: run once, read-only against the repository, using a throwaway
virtualenv (never the shared `separador-pistas` venv) built from
`D:\\cursos\\separador-pistas\\.venv\\Scripts\\python.exe -m venv <scratch>`,
then `pip install onnx numpy` into that throwaway venv only. See
`odd/tasks/p7b-onnx-worker.md` "Progress / evidence" for the exact recorded
venv path, package versions, and command.

Usage:
    <throwaway-venv-python> generate_synthetic_models.py
"""

from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, checker, helper

OUTPUT_DIR = Path(__file__).resolve().parent
OPSET = 17

MIX_SHAPE = [1, 2, 343_980]
MAG_SHAPE = [1, 4, 2048, 336]
STEMS_SHAPE = [1, 6, 2, 343_980]
FREQ_SHAPE = [1, 4, 4, 2048, 336]
TIME_SHAPE = [1, 4, 2, 343_980]


def shape_initializer(name: str, shape: list[int]) -> onnx.TensorProto:
    """An int64 1-D tensor initializer holding a target shape for Reshape."""
    return helper.make_tensor(name, TensorProto.INT64, [len(shape)], shape)


def repeats_initializer(name: str, repeats: list[int]) -> onnx.TensorProto:
    """An int64 1-D tensor initializer holding per-axis repeat counts for Tile."""
    return helper.make_tensor(name, TensorProto.INT64, [len(repeats)], repeats)


def scalar_initializer(name: str, value: float) -> onnx.TensorProto:
    """A float32 scalar initializer used as the branch's single deterministic weight."""
    return helper.make_tensor(name, TensorProto.FLOAT, [], [value])


def build_rock_model() -> onnx.ModelProto:
    mix = helper.make_tensor_value_info("mix", TensorProto.FLOAT, MIX_SHAPE)
    stems = helper.make_tensor_value_info("stems", TensorProto.FLOAT, STEMS_SHAPE)

    initializers = [
        shape_initializer("mix_expand_shape", [1, 1, 2, 343_980]),
        repeats_initializer("stems_repeats", [1, 6, 1, 1]),
        scalar_initializer("stems_scale", 2.0),
    ]
    nodes = [
        helper.make_node("Reshape", ["mix", "mix_expand_shape"], ["mix_expanded"]),
        helper.make_node("Tile", ["mix_expanded", "stems_repeats"], ["mix_tiled"]),
        helper.make_node("Mul", ["mix_tiled", "stems_scale"], ["stems"]),
    ]

    graph = helper.make_graph(nodes, "rock_synthetic", [mix], [stems], initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", OPSET)])
    model.ir_version = 8
    checker.check_model(model)
    return model


def build_basic_model() -> onnx.ModelProto:
    mix = helper.make_tensor_value_info("mix", TensorProto.FLOAT, MIX_SHAPE)
    mag = helper.make_tensor_value_info("mag", TensorProto.FLOAT, MAG_SHAPE)
    freq = helper.make_tensor_value_info("freq", TensorProto.FLOAT, FREQ_SHAPE)
    time = helper.make_tensor_value_info("time", TensorProto.FLOAT, TIME_SHAPE)

    initializers = [
        shape_initializer("mag_expand_shape", [1, 4, 1, 2048, 336]),
        repeats_initializer("freq_repeats", [1, 1, 4, 1, 1]),
        scalar_initializer("freq_scale", 3.0),
        shape_initializer("mix_expand_shape", [1, 1, 2, 343_980]),
        repeats_initializer("time_repeats", [1, 4, 1, 1]),
        scalar_initializer("time_scale", 5.0),
    ]
    nodes = [
        helper.make_node("Reshape", ["mag", "mag_expand_shape"], ["mag_expanded"]),
        helper.make_node("Tile", ["mag_expanded", "freq_repeats"], ["mag_tiled"]),
        helper.make_node("Mul", ["mag_tiled", "freq_scale"], ["freq"]),
        helper.make_node("Reshape", ["mix", "mix_expand_shape"], ["mix_expanded"]),
        helper.make_node("Tile", ["mix_expanded", "time_repeats"], ["mix_tiled"]),
        helper.make_node("Mul", ["mix_tiled", "time_scale"], ["time"]),
    ]

    graph = helper.make_graph(nodes, "basic_synthetic", [mix, mag], [freq, time], initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", OPSET)])
    model.ir_version = 8
    checker.check_model(model)
    return model


def verify_with_onnxruntime(path: Path, feeds: dict[str, np.ndarray], expected: dict[str, np.ndarray]) -> None:
    """Optional extra sanity check with a real session, when onnxruntime is
    available in the throwaway venv. Never required for GREEN: the browser
    test against `onnxruntime-web` is the real, recorded verification.
    """
    try:
        import onnxruntime as ort
    except ImportError:
        print(f"  (onnxruntime not installed in this venv; skipping optional native check for {path.name})")
        return

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    outputs = session.run(None, feeds)
    for name, actual in zip((o.name for o in session.get_outputs()), outputs):
        np.testing.assert_allclose(actual, expected[name], rtol=0, atol=1e-6)
    print(f"  onnxruntime CPU check passed for {path.name}")


def main() -> None:
    rock_path = OUTPUT_DIR / "rock-synthetic.onnx"
    basic_path = OUTPUT_DIR / "basic-synthetic.onnx"

    onnx.save(build_rock_model(), rock_path)
    onnx.save(build_basic_model(), basic_path)

    print(f"wrote {rock_path} ({rock_path.stat().st_size} bytes)")
    print(f"wrote {basic_path} ({basic_path.stat().st_size} bytes)")

    ones_mix = np.ones(MIX_SHAPE, dtype=np.float32)
    ones_mag = np.ones(MAG_SHAPE, dtype=np.float32)

    verify_with_onnxruntime(
        rock_path,
        {"mix": ones_mix},
        {"stems": np.full(STEMS_SHAPE, 2.0, dtype=np.float32)},
    )
    verify_with_onnxruntime(
        basic_path,
        {"mix": ones_mix, "mag": ones_mag},
        {
            "freq": np.full(FREQ_SHAPE, 3.0, dtype=np.float32),
            "time": np.full(TIME_SHAPE, 5.0, dtype=np.float32),
        },
    )


if __name__ == "__main__":
    main()
