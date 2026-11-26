"""Loopback-only OpenAI-compatible fixture; never contacts an external provider."""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        messages = json.dumps(data.get("messages", []), ensure_ascii=False)
        matches = re.findall(r"dshwm-[a-z0-9-]+", messages)
        marker = matches[-1] if matches else None
        model = data["model"]
        print(json.dumps(dict(marker=marker, model=model, provider=self.path.split("/")[1],
                              effort=data.get("reasoning_effort"),
                              title="Generate the session title" in messages)), flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for delta, finish in [({"role": "assistant", "content": "ack " + (marker or "fixture")}, None), ({}, "stop")]:
            chunk = dict(id="fixture", object="chat.completion.chunk", created=1, model=model,
                         choices=[dict(index=0, delta=delta, finish_reason=finish)])
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *_args):
        pass

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
