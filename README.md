# About
Grpc file server - Upload and download files via GRPC bi-direction stream.

Server will save file on disk. When you send get request server will read file and save in ram cache for fast
next delivery

# Features
- BiDirection upload and download stream
- GRPC Reflection
- Setup max disk and ram storage size
- Auto remove old files
- Move files to RAM when download first time for fast delivery
- Use LRU for disk and ram memory storage

# Ports
- Grpc - 3000
- Metrics - 9090 (http://localhost:9090/metrics)

# Client example
See example for upload and download files: [examples/upload-download.js](examples/upload-download.js)