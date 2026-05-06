#!/bin/bash
cd "$(dirname "$0")"
node server.js &
sleep 1
open http://localhost:8765
wait
