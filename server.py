from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs
import json
import os
import pathlib
import secrets
import hashlib

def resolve_data_file():
    env_override = os.environ.get('ORB_DATA_FILE', '').strip()
    if env_override:
        return pathlib.Path(env_override)

    # Hosted environments can have read-only source dirs; use /tmp when PORT is set.
    if os.environ.get('PORT'):
        return pathlib.Path('/tmp/game-orbs-users.json')

    return pathlib.Path(__file__).parent / 'users.json'


DATA_FILE = resolve_data_file()

if not DATA_FILE.exists():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps({'users': {}, 'sessions': {}}), encoding='utf-8')

with open(DATA_FILE, 'r', encoding='utf-8') as f:
    try:
        data = json.load(f)
    except Exception:
        data = {'users': {}, 'sessions': {}}

USERS = data.get('users', {})
SESSIONS = data.get('sessions', {})

DEFAULT_USER_STATE = {
    'highScore': 0,
    'tokens': 0,
    'ownedBoost': False,
    'ownedTeleport': False,
    'ownedFastFeet': False,
    'ownedPassive': False,
    'equipped': [],
    'stunKey': 'e',
    'boostKey': 'Space',
    'colors': {
        'player': '#66e',
        'enemy': '#e34d4d',
        'wall': '#87cefa',
        'orb': '#ffd166',
        'finish': '#2ecc71'
    },
    'characterLevel': 0,
    'speedLevel': 0,
    'tokenLevel': 0,
    'cooldownLevel': 0,
    'boostLevel': 0,
    'teleportLevel': 0,
    'fastFeetLevel': 0,
    'passiveLevel': 0
}


def save_data():
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump({'users': USERS, 'sessions': SESSIONS}, f, indent=2)


def make_token():
    return secrets.token_urlsafe(24)


def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


def parse_json_body(length, rfile):
    raw = rfile.read(length).decode('utf-8')
    try:
        return json.loads(raw)
    except Exception:
        return {}


def find_username_case_insensitive(username):
    target = (username or '').strip().lower()
    if not target:
        return None
    for existing in USERS.keys():
        if existing.lower() == target:
            return existing
    return None


class APIHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/signup':
            self.handle_signup()
        elif self.path == '/api/login':
            self.handle_login()
        elif self.path == '/api/user':
            self.handle_user_update()
        else:
            self.send_error(404, 'Not found')

    def do_GET(self):
        if self.path == '/api/me':
            self.handle_me()
        else:
            super().do_GET()

    def handle_signup(self):
        length = int(self.headers.get('Content-Length', 0))
        body = parse_json_body(length, self.rfile)
        username = body.get('username', '').strip()
        password = body.get('password', '')
        if not username or not password:
            self.send_json({'message': 'Username and password are required.'}, 400)
            return
        if find_username_case_insensitive(username):
            self.send_json({'message': 'Username already exists.'}, 400)
            return
        USERS[username] = {
            'passwordHash': hash_password(password),
            **DEFAULT_USER_STATE
        }
        token = make_token()
        SESSIONS[token] = username
        save_data()
        self.send_json({'username': username, 'token': token, 'user': USERS[username]})

    def handle_login(self):
        length = int(self.headers.get('Content-Length', 0))
        body = parse_json_body(length, self.rfile)
        username = body.get('username', '').strip()
        password = body.get('password', '')
        if not username or not password:
            self.send_json({'message': 'Username and password are required.'}, 400)
            return
        actual_username = find_username_case_insensitive(username)
        user = USERS.get(actual_username) if actual_username else None
        if not user or user.get('passwordHash') != hash_password(password):
            self.send_json({'message': 'Invalid username or password.'}, 401)
            return
        token = make_token()
        SESSIONS[token] = actual_username
        save_data()
        self.send_json({'username': actual_username, 'token': token, 'user': user})

    def handle_me(self):
        auth = self.headers.get('Authorization', '')
        token = auth.replace('Bearer ', '').strip()
        username = SESSIONS.get(token)
        if not username or username not in USERS:
            self.send_json({'message': 'Unauthorized.'}, 401)
            return
        self.send_json({'username': username, 'user': USERS[username]})

    def handle_user_update(self):
        auth = self.headers.get('Authorization', '')
        token = auth.replace('Bearer ', '').strip()
        username = SESSIONS.get(token)
        if not username or username not in USERS:
            self.send_json({'message': 'Unauthorized.'}, 401)
            return
        length = int(self.headers.get('Content-Length', 0))
        body = parse_json_body(length, self.rfile)
        user = USERS[username]
        for key in ['highScore', 'tokens', 'ownedBoost', 'ownedTeleport', 'ownedFastFeet', 'ownedPassive', 'equipped', 'stunKey', 'boostKey', 'colors', 'characterLevel', 'speedLevel', 'tokenLevel', 'cooldownLevel', 'boostLevel', 'teleportLevel', 'fastFeetLevel', 'passiveLevel']:
            if key in body:
                user[key] = body[key]
        USERS[username] = user
        save_data()
        self.send_json({'username': username, 'user': user})

    def send_json(self, obj, status=200):
        self.send_response(status)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(obj).encode('utf-8'))

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    server_address = ('', port)
    print(f'Starting server at http://localhost:{port}')
    HTTPServer(server_address, APIHandler).serve_forever()
