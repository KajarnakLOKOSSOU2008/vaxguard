"""
VaxGuard - Gemma 2B LLM Analysis Layer
=======================================

Loads Gemma 2B (Q3_IQ3_M GGUF, 1.4GB) via llama-cpp-python.
Provides natural-language interpretation of CNN-GRU predictions:
- Why the model predicts this trajectory
- Recommended action for the driver
- Risk communication in plain French/English
- Few-shot examples for cold-chain context

This is the "second opinion" LLM layer that runs server-side
(tablet at the dispensary). The CNN-GRU stays on ESP32 (Edge-AI).
"""

import os
import json
import time
import threading
from typing import Optional, Dict, Any, List

MODEL_PATH = "/home/z/my-project/download/llm/gemma-2-2b-it-IQ3_M.gguf"

# Lazy load (only when first inference requested)
_llm = None
_llm_lock = threading.Lock()


def get_llm():
    global _llm
    if _llm is None:
        with _llm_lock:
            if _llm is None:
                from llama_cpp import Llama
                print(f"[gemma] Loading Gemma 2B GGUF from {MODEL_PATH}...")
                t0 = time.time()
                _llm = Llama(
                    model_path=MODEL_PATH,
                    n_ctx=4096,        # context window
                    n_threads=4,        # CPU threads
                    n_gpu_layers=0,     # CPU only
                    verbose=False,
                    chat_format="gemma",  # Gemma chat template
                )
                print(f"[gemma] Loaded in {time.time()-t0:.1f}s")

    return _llm


def is_available() -> bool:
    """Check if Gemma model file exists."""
    return os.path.exists(MODEL_PATH) and os.path.getsize(MODEL_PATH) > 1_000_000


def build_analysis_prompt(prediction: Dict[str, Any], reading: Dict[str, Any],
                          scenario: str, threshold_c: float = 8.0,
                          lang: str = "fr") -> List[Dict[str, str]]:
    """Build chat messages for Gemma to analyze the current state."""
    if lang == "fr":
        sys_prompt = (
            "Tu es VaxGuard Assistant, un expert en logistique de chaîne du froid pour vaccins au Bénin. "
            "Tu analyses les prédictions d'un modèle CNN-GRU qui tourne sur un ESP32-S3 (Edge-AI). "
            "Donne des recommandations claires, concises et actionnables en français. "
            "Réponds en moins de 200 mots."
        )
        user = (
            f"Contexte: transport de vaccins, scénario '{scenario}'. "
            f"Température interne glacière: {reading.get('t_internal', 0):.2f}°C. "
            f"Température ambiante: {reading.get('t_ambient', 0):.2f}°C. "
            f"Humidité: {reading.get('humidity', 0):.1f}%. "
            f"Prédiction IA: {prediction.get('minutes_to_threshold', 0):.0f} minutes avant franchissement du seuil {threshold_c}°C. "
            f"Niveau de risque: {prediction.get('risk_label', 'safe')} (confiance {prediction.get('confidence', 0)*100:.0f}%). "
            f"GPS véhicule: {reading.get('vehicle_lat', 0):.4f}, {reading.get('vehicle_lng', 0):.4f}. "
            f"Dispensaire le plus proche: {reading.get('nearest_dispensaire', {}).get('name', 'inconnu')} à {reading.get('nearest_dispensaire', {}).get('distance_km', 0)} km.\n\n"
            "Donne 3 choses:\n"
            "1. Diagnostic: pourquoi cette situation est-elle risquée?\n"
            "2. Action recommandée pour le chauffeur (1 phrase, actionnables immédiatement)\n"
            "3. Action recommandée pour le dispensaire (1 phrase)\n"
        )
    else:
        sys_prompt = (
            "You are VaxGuard Assistant, an expert in cold-chain logistics for vaccines in Bénin. "
            "You analyze predictions from a CNN-GRU model running on an ESP32-S3 (Edge-AI). "
            "Give clear, concise, actionable recommendations in English. "
            "Reply in less than 200 words."
        )
        user = (
            f"Context: vaccine transport, scenario '{scenario}'. "
            f"Cooler internal temp: {reading.get('t_internal', 0):.2f}°C. "
            f"Ambient temp: {reading.get('t_ambient', 0):.2f}°C. "
            f"Humidity: {reading.get('humidity', 0):.1f}%. "
            f"AI prediction: {prediction.get('minutes_to_threshold', 0):.0f} minutes before crossing {threshold_c}°C threshold. "
            f"Risk level: {prediction.get('risk_label', 'safe')} (confidence {prediction.get('confidence', 0)*100:.0f}%). "
            f"Vehicle GPS: {reading.get('vehicle_lat', 0):.4f}, {reading.get('vehicle_lng', 0):.4f}. "
            f"Nearest dispensary: {reading.get('nearest_dispensaire', {}).get('name', 'unknown')} at {reading.get('nearest_dispensaire', {}).get('distance_km', 0)} km.\n\n"
            "Give 3 things:\n"
            "1. Diagnosis: why is this situation risky?\n"
            "2. Recommended driver action (1 sentence, immediately actionable)\n"
            "3. Recommended dispensary action (1 sentence)\n"
        )

    return [
        {"role": "user", "content": f"{sys_prompt}\n\n{user}"},
    ]


def analyze(prediction: Dict[str, Any], reading: Dict[str, Any],
            scenario: str, threshold_c: float = 8.0, lang: str = "fr") -> Dict[str, Any]:
    """Run Gemma 2B analysis on the current prediction + reading."""
    if not is_available():
        return {"ready": False, "error": "Gemma 2B model not available"}

    try:
        llm = get_llm()
        messages = build_analysis_prompt(prediction, reading, scenario, threshold_c, lang)

        t0 = time.time()
        resp = llm.create_chat_completion(
            messages=messages,
            max_tokens=400,
            temperature=0.7,
            top_p=0.9,
            repeat_penalty=1.1,
        )
        elapsed = time.time() - t0

        content = resp["choices"][0]["message"]["content"].strip()
        usage = resp.get("usage", {})

        return {
            "ready": True,
            "analysis": content,
            "inference_time_s": round(elapsed, 2),
            "tokens_prompt": usage.get("prompt_tokens", 0),
            "tokens_completion": usage.get("completion_tokens", 0),
            "model": "gemma-2-2b-it (Q3_IQ3_M)",
            "lang": lang,
            "timestamp": time.time(),
        }
    except Exception as e:
        return {"ready": False, "error": str(e)}


def info() -> Dict[str, Any]:
    """Return info about the loaded Gemma model."""
    return {
        "model_name": "Gemma 2B (google/gemma-2-2b-it)",
        "quantization": "IQ3_M GGUF (~1.4 GB)",
        "framework": "llama-cpp-python (CPU)",
        "params_billions": 2.0,
        "loaded": _llm is not None,
        "available": is_available(),
        "model_path": MODEL_PATH,
        "size_mb": round(os.path.getsize(MODEL_PATH) / (1024*1024), 1) if is_available() else 0,
    }


if __name__ == "__main__":
    # Quick test
    print("Testing Gemma 2B...")
    info_d = info()
    print(json.dumps(info_d, indent=2))

    if info_d["available"]:
        # Test analysis
        fake_pred = {
            "ready": True,
            "minutes_to_threshold": 8.5,
            "risk_label": "critical",
            "confidence": 0.92,
        }
        fake_reading = {
            "t_internal": 7.2,
            "t_ambient": 32.5,
            "humidity": 62,
            "vehicle_lat": 7.19,
            "vehicle_lng": 2.04,
            "nearest_dispensaire": {"name": "Hôpital de Zone d'Abomey", "distance_km": 4.5},
        }
        print("\n--- French analysis ---")
        result = analyze(fake_pred, fake_reading, "solar_burst", 8.0, "fr")
        print(json.dumps(result, indent=2, ensure_ascii=False))
