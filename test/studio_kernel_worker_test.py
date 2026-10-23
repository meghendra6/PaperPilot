"""Integration test: run with the configured Studio Python environment."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import uuid


WORKER = Path(__file__).resolve().parents[1] / "addon/chrome/content/studio/kernel_worker.py"


class KernelIntegration(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="paperpilot-kernel-")
        self.root = Path(self.temporary.name)
        (self.root / "workspace").mkdir()
        (self.root / "heartbeat").write_text("alive")
        self.process = subprocess.Popen([sys.executable, str(WORKER), str(self.root), "python3"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.assertTrue(self.wait("ready.json", 40)["ok"])

    def tearDown(self):
        (self.root / "shutdown").write_text("shutdown")
        try:
            self.process.wait(timeout=8)
        finally:
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait()
            self.temporary.cleanup()

    def wait(self, name, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            (self.root / "heartbeat").write_text("alive")
            path = self.root / name
            if path.exists():
                return json.loads(path.read_text())
            time.sleep(0.1)
        self.fail(f"Timed out waiting for {name}")

    def submit(self, code):
        request_id = str(uuid.uuid4())
        temporary = self.root / "request.tmp"
        temporary.write_text(json.dumps({"id": request_id, "code": code}))
        temporary.replace(self.root / "request.json")
        return f"response-{request_id}.json"

    def execute(self, code):
        return self.wait(self.submit(code))

    def interrupt(self, response):
        request_id = response.removeprefix("response-").removesuffix(".json")
        temporary = self.root / "interrupt.tmp"
        temporary.write_text(json.dumps({"id": request_id}))
        temporary.replace(self.root / "interrupt")

    def queue_while_paused(self, code, canceled_response=None):
        self.process.send_signal(signal.SIGSTOP)
        try:
            _, status = os.waitpid(self.process.pid, os.WUNTRACED)
            self.assertTrue(os.WIFSTOPPED(status))
            response = self.submit(code)
            self.interrupt(canceled_response or response)
            return response
        finally:
            self.process.send_signal(signal.SIGCONT)

    def test_persistent_state_errors_figures_and_interrupt(self):
        first = self.execute("value = 21\nprint('한글', value)")
        self.assertEqual(first["status"], "ok")
        self.assertIn("한글 21", first["outputs"][0]["text"])
        second = self.execute("value * 2")
        self.assertEqual(second["outputs"][0]["data"]["text/plain"], "42")
        failed = self.execute("1 / 0")
        self.assertEqual(failed["status"], "error")
        self.assertEqual(failed["outputs"][0]["ename"], "ZeroDivisionError")
        plotted = self.execute("%matplotlib inline\nimport matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])\nplt.show()")
        self.assertTrue(any(output.get("data", {}).get("image/png") for output in plotted["outputs"]))
        response = self.submit("while True: pass")
        time.sleep(0.5)
        self.interrupt(response)
        interrupted = self.wait(response)
        self.assertEqual(interrupted["status"], "error")
        self.assertEqual(interrupted["outputs"][-1]["ename"], "KeyboardInterrupt")
        recovered = self.execute("value + 1")
        self.assertEqual(recovered["outputs"][0]["data"]["text/plain"], "22")

    @unittest.skipUnless(hasattr(signal, "SIGSTOP"), "Requires POSIX process suspension")
    def test_queued_stop_skips_code_and_late_stop_does_not_cancel_next_request(self):
        canceled_response = self.queue_while_paused("queued_ran = True")
        canceled = self.wait(canceled_response)
        self.assertEqual(canceled["status"], "error")
        self.assertIsNone(canceled["execution_count"])
        self.assertEqual(canceled["outputs"][-1]["ename"], "InterruptedError")
        next_response = self.queue_while_paused("'queued_ran' in globals()", canceled_response)
        next_result = self.wait(next_response)
        self.assertEqual(next_result["status"], "ok")
        self.assertEqual(next_result["outputs"][0]["data"]["text/plain"], "False")

    def test_clear_output_wait_and_display_updates(self):
        retained = self.execute("from IPython.display import display, clear_output\nprint('retained', flush=True)\nclear_output(wait=True)")
        self.assertEqual(retained["outputs"][0]["text"], "retained\n")
        replaced = self.execute("print('old', flush=True)\nclear_output(wait=True)\nprint('new', flush=True)")
        self.assertEqual(len(replaced["outputs"]), 1)
        self.assertEqual(replaced["outputs"][0]["text"], "new\n")
        first = self.execute("handle = display('before', display_id=True)\nhandle.update('after')")
        self.assertEqual(first["outputs"][0]["data"]["text/plain"], "'after'")
        self.assertTrue(first["displayIDs"])
        next_cell = self.execute("handle.update('later cell')")
        self.assertFalse(next_cell["outputs"])
        self.assertEqual(next_cell["displayUpdates"][0]["data"]["text/plain"], "'later cell'")
        cleared = self.execute("print('old', flush=True)\nclear_output(wait=False)")
        self.assertFalse(cleared["outputs"])


if __name__ == "__main__":
    unittest.main()
