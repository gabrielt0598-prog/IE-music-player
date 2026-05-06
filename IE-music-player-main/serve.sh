#!/bin/bash
cd "$(dirname "$0")"
echo "Open http://localhost:8080 in your browser"
python3 -m http.server 8080
