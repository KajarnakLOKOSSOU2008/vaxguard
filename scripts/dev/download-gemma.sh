#!/usr/bin/env bash
# Download Gemma 2B GGUF for local inference (CPU)
# Run this once before starting the AI service.
set -e

MODEL_DIR="$(dirname "$0")/../download/llm"
mkdir -p "$MODEL_DIR"

URL="https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-IQ3_M.gguf"
OUT="$MODEL_DIR/gemma-2-2b-it-IQ3_M.gguf"

if [ -f "$OUT" ] && [ "$(stat -c%s "$OUT")" -gt 1000000000 ]; then
  echo "Gemma 2B already downloaded: $OUT ($(du -h "$OUT" | cut -f1))"
  exit 0
fi

echo "Downloading Gemma 2B IQ3_M GGUF (~1.4GB)..."
echo "Source: $URL"
echo "Target: $OUT"
curl -L --progress-bar -o "$OUT" "$URL"

echo ""
echo "Done. File size: $(du -h "$OUT" | cut -f1)"
echo "Now you can start the AI service: bash scripts/start-ai-service.sh"
