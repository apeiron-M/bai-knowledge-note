"""Start/stop the vendored llama-server (b11364) for template, tokenizer and
inference checks. Used as a context manager so no process outlives a run."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# Native tools live outside the repo so the root tsconfig/vitest globs never see llama.cpp's sources.
TOOLS = Path(os.environ.get("BAI_TRAINING_TOOLS", Path.home() / ".cache/bai-training"))
LLAMA_CPP = TOOLS / "llama.cpp"
SERVER_BIN = LLAMA_CPP / "build/bin/llama-server"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LlamaServer:
    def __init__(self, gguf: str | Path, n_ctx: int = 4096, extra: list[str] | None = None):
        self.gguf = str(gguf)
        self.port = free_port()
        # --no-jinja: wllama runs with jinja off (results doc, Environment).
        self.args = [str(SERVER_BIN), "-m", self.gguf, "--port", str(self.port), "--host", "127.0.0.1",
                     "-c", str(n_ctx), "-np", "1", "--no-jinja", "--no-webui", *(extra or [])]
        self.proc: subprocess.Popen | None = None
        self.log_path = REPO / "training/artifacts/llama-server.log"

    def __enter__(self) -> "LlamaServer":
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self._log = open(self.log_path, "w")
        self.proc = subprocess.Popen(self.args, stdout=self._log, stderr=subprocess.STDOUT)
        deadline = time.time() + 120
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"llama-server exited early, see {self.log_path}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=2) as r:
                    if r.status == 200:
                        return self
            except OSError:
                time.sleep(0.25)
        raise RuntimeError("llama-server did not become healthy")

    def __exit__(self, *exc) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self._log.close()

    def post(self, route: str, body: dict) -> dict:
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{route}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())
