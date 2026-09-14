import os
import json
import time
import re
import base64
import mimetypes
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
UPLOADS_DIR = os.path.join(ASSETS_DIR, 'uploads')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

MEDIA_FILE = os.path.join(DATA_DIR, 'media.json')
ORDERS_FILE = os.path.join(DATA_DIR, 'orders.json')

class JacksonBarHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        clean_path = self.path.split('?')[0]
        if clean_path == '/api/media':
            if os.path.exists(MEDIA_FILE):
                try:
                    with open(MEDIA_FILE, 'r', encoding='utf-8') as f:
                        return self._send_json(json.load(f))
                except Exception as e:
                    return self._send_json({'error': str(e)}, 500)
            return self._send_json({})

        elif clean_path == '/api/orders':
            if os.path.exists(ORDERS_FILE):
                try:
                    with open(ORDERS_FILE, 'r', encoding='utf-8') as f:
                        return self._send_json(json.load(f))
                except Exception as e:
                    return self._send_json({'error': str(e)}, 500)
            return self._send_json([])

        # Video range request support for smooth streaming
        range_header = self.headers.get('Range')
        file_rel = clean_path.lstrip('/')
        file_path = os.path.join(BASE_DIR, file_rel.replace('/', os.sep))

        if range_header and os.path.isfile(file_path) and file_rel.endswith(('.mp4', '.webm', '.ogv')):
            try:
                total_size = os.path.getsize(file_path)
                m = re.search(r'bytes=(\d+)-(\d*)', range_header)
                if m:
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else total_size - 1
                    if end >= total_size:
                        end = total_size - 1
                    length = end - start + 1

                    self.send_response(206)
                    mime, _ = mimetypes.guess_type(file_path)
                    self.send_header('Content-Type', mime or 'video/mp4')
                    self.send_header('Content-Range', f'bytes {start}-{end}/{total_size}')
                    self.send_header('Content-Length', str(length))
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()

                    with open(file_path, 'rb') as f:
                        f.seek(start)
                        sent = 0
                        chunk_size = 64 * 1024
                        while sent < length:
                            to_read = min(chunk_size, length - sent)
                            buf = f.read(to_read)
                            if not buf:
                                break
                            self.wfile.write(buf)
                            sent += len(buf)
                    return
            except Exception:
                pass

        return super().do_GET()

    def do_POST(self):
        clean_path = self.path.split('?')[0]
        content_type = self.headers.get('Content-Type', '')
        content_length = int(self.headers.get('Content-Length', 0))

        if clean_path == '/api/media':
            try:
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body)
                with open(MEDIA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                return self._send_json({'success': True, 'data': data})
            except Exception as e:
                return self._send_json({'error': str(e)}, 500)

        elif clean_path == '/api/orders':
            try:
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body)
                with open(ORDERS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                return self._send_json({'success': True})
            except Exception as e:
                return self._send_json({'error': str(e)}, 500)

        elif clean_path == '/api/delete-file':
            try:
                body = self.rfile.read(content_length).decode('utf-8')
                payload = json.loads(body)
                rel_path = payload.get('path', '')
                if rel_path and rel_path.startswith('assets/uploads/'):
                    clean_rel = os.path.normpath(rel_path)
                    if not clean_rel.startswith('..'):
                        full_path = os.path.join(BASE_DIR, clean_rel)
                        if os.path.isfile(full_path):
                            os.remove(full_path)
                            return self._send_json({'success': True, 'deleted': rel_path})
                return self._send_json({'success': False, 'message': 'File not found or not in uploads'})
            except Exception as e:
                return self._send_json({'error': str(e)}, 500)

        elif clean_path == '/api/upload':
            try:
                if 'multipart/form-data' in content_type:
                    boundary_match = re.search(r'boundary=([^;]+)', content_type)
                    if not boundary_match:
                        return self._send_json({'error': 'Invalid multipart boundary'}, 400)
                    boundary = boundary_match.group(1).strip().strip('"').encode('ascii')
                    body = self.rfile.read(content_length)
                    parts = body.split(b'--' + boundary)
                    for part in parts:
                        if b'filename="' in part:
                            header_part, content_part = part.split(b'\r\n\r\n', 1)
                            header_str = header_part.decode('utf-8', errors='ignore')
                            fn_match = re.search(r'filename="([^"]+)"', header_str)
                            raw_fn = fn_match.group(1) if fn_match else f'file_{int(time.time())}.bin'
                            raw_base, ext = os.path.splitext(os.path.basename(raw_fn))
                            if not ext:
                                ext = '.bin'
                            clean_base = re.sub(r'[^a-zA-Z0-9_]', '', raw_base)[:30]
                            clean_fn = f"upload_{int(time.time())}_{clean_base}{ext}"

                            # Trim trailing \r\n from multipart chunk safely
                            if content_part.endswith(b'\r\n--'):
                                file_data = content_part[:-4]
                            elif content_part.endswith(b'\r\n'):
                                file_data = content_part[:-2]
                            else:
                                file_data = content_part

                            target_path = os.path.join(UPLOADS_DIR, clean_fn)
                            with open(target_path, 'wb') as f:
                                f.write(file_data)
                            return self._send_json({'success': True, 'url': f'assets/uploads/{clean_fn}', 'size': len(file_data)})
                    return self._send_json({'error': 'No file found in upload'}, 400)
                else:
                    # Base64 JSON fallback
                    body = self.rfile.read(content_length).decode('utf-8')
                    payload = json.loads(body)
                    raw_fn = payload.get('filename', f'file_{int(time.time())}.bin')
                    raw_base, ext = os.path.splitext(os.path.basename(raw_fn))
                    clean_base = re.sub(r'[^a-zA-Z0-9_]', '', raw_base)[:30]
                    clean_fn = f"upload_{int(time.time())}_{clean_base}{ext}"
                    b64_data = payload.get('data', '')
                    if ',' in b64_data:
                        b64_data = b64_data.split(',')[1]
                    file_bytes = base64.b64decode(b64_data)
                    target_path = os.path.join(UPLOADS_DIR, clean_fn)
                    with open(target_path, 'wb') as f:
                        f.write(file_bytes)
                    return self._send_json({'success': True, 'url': f'assets/uploads/{clean_fn}', 'size': len(file_bytes)})
            except Exception as e:
                return self._send_json({'error': str(e)}, 500)

        return self._send_json({'error': 'Not found'}, 404)

if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = HTTPServer(('0.0.0.0', port), JacksonBarHandler)
    print(f'Server running on port {port} with upload support...')
    server.serve_forever()

