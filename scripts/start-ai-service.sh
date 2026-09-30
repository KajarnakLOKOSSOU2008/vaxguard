#!/bin/bash
# Robust AI service launcher - completely detaches from parent shell
cd /home/z/my-project/mini-services/ai-service

# Kill any existing
pkill -f "python3 main.py" 2>/dev/null
sleep 1

# Launch with setsid + nohup, all stdio redirected, fully detached
setsid -f bash -c 'exec python3 main.py' >> ai.log 2>&1 < /dev/null

# Wait briefly and verify
sleep 3
if pgrep -f "python3 main.py" > /dev/null; then
  echo "AI service started: $(pgrep -f 'python3 main.py' | tr '\n' ' ')"
else
  echo "FAILED to start"
  tail -20 ai.log
  exit 1
fi
