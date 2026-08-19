"""
Satark AI — admin dashboard host.

This used to be a Streamlit app that ran YOLO detection in-process.
It isn't anymore: all detection now runs inside the FastAPI backend
(server.py -> monitor.py -> monitor_session.py -> detection.py), which
this dashboard talks to over plain HTTP + a WebSocket. So this file's
only job now is to serve the static admin page (index.html/app.js/
styles.css/shield.svg) on its own port.

Usage:
    python main.py

Then open the URL it prints (e.g. http://localhost:8501). Inside the
page, the "FastAPI backend URL" box at the top must point at wherever
`uvicorn server:app` is running — same host/port for both the admin
page and the Expo app.

Files expected next to this one: index.html, app.js, styles.css,
shield.svg.
"""
import http.server
import os
import socketserver
import sys
import webbrowser

PORT = int(os.environ.get("ADMIN_PORT", 8501))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

REQUIRED_FILES = ["index.html", "app.js", "styles.css"]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Dev convenience: don't let the browser cache app.js/index.html
        # while you're actively editing them.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        sys.stderr.write("[admin-static] %s - %s\n" % (self.address_string(), format % args))


def main():
    missing = [f for f in REQUIRED_FILES if not os.path.isfile(os.path.join(DIRECTORY, f))]
    if missing:
        print(f"Missing file(s) next to main.py: {', '.join(missing)}")
        print(f"Looked in: {DIRECTORY}")
        print("Put index.html, app.js, styles.css (and shield.svg) in the same "
              "folder as main.py, then run this again.")
        sys.exit(1)

    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/index.html"
        print(f"Admin dashboard serving at: {url}")
        print(f"(also reachable on your LAN at http://<your-ip>:{PORT}/index.html)")
        print("Make sure the 'FastAPI backend URL' field inside the page matches "
              "wherever `uvicorn server:app` is running.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down admin dashboard server.")


if __name__ == "__main__":
    main()