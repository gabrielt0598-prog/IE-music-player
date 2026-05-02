#!/bin/bash
# Kill anything already on 8080
lsof -ti:8080 | xargs kill -9 2>/dev/null
sleep 0.2

cd "$(dirname "$0")"
python3 -m http.server 8080 &
SERVER_PID=$!
sleep 0.4

open "http://localhost:8080"

echo "Gesture Controller running at http://localhost:8080"
echo "Close this window to stop."
wait $SERVER_PID
