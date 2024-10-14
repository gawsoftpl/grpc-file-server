# About

..todo

Grpc file server - Upload and download files via GRPC bi-direction stream.

Server will save file on disk. When you send get request server will read file and save in ram cache for fast
next delivery

# Ports
- Grpc - 3000
- Metrics - 9090 (http://localhost:9090/metrics)