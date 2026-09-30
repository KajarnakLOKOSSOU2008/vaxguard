"""Re-export ONNX (after onnxscript install) and update manifest."""
import os, json, torch, torch.nn as nn, torch.nn.functional as F
import sys
sys.path.insert(0, "/home/z/my-project/scripts/ai")
from train_model import VaxGuardCNN_GRU, MODEL_DIR, WINDOW, N_FEATURES

model = VaxGuardCNN_GRU()
model.load_state_dict(torch.load(os.path.join(MODEL_DIR, "vaxguard_cnn_gru.pt")))
model.eval()

onnx_path = os.path.join(MODEL_DIR, "vaxguard_cnn_gru.onnx")
example = torch.rand(1, WINDOW, N_FEATURES)
torch.onnx.export(
    model, example, onnx_path,
    export_params=True, opset_version=13,
    input_names=["sensor_window"],
    output_names=["mtt", "risk_logits"],
    dynamic_axes={"sensor_window": {0: "batch"}, "mtt": {0: "batch"}, "risk_logits": {0: "batch"}},
)
print(f"ONNX: {onnx_path}  ({os.path.getsize(onnx_path)/1024:.1f} KB)")

# Update manifest
with open(os.path.join(MODEL_DIR, "model_manifest.json")) as f:
    m = json.load(f)
m["size_kb"]["onnx"] = round(os.path.getsize(onnx_path) / 1024, 1)
with open(os.path.join(MODEL_DIR, "model_manifest.json"), "w") as f:
    json.dump(m, f, indent=2, default=str)
print("Manifest updated.")
