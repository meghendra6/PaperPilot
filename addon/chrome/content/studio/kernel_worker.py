"""Owned, file-based Jupyter worker. No HTTP server and no automatic code runs.

Usage: python kernel_worker.py JOB_DIRECTORY python3|ir
The parent writes heartbeat/request/interrupt/shutdown files atomically. Each
response is published under its request ID; only one execution is admitted.
"""

import json
import os
from pathlib import Path
import queue
import sys
import time


def publish(path, value):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def run(root, kernel_name):
    from jupyter_client import KernelManager

    if kernel_name not in ("python3", "ir"):
        raise ValueError("Choose the Python or R kernel.")
    manager = KernelManager(kernel_name=kernel_name, connection_file=str(root / "connection.json"))
    manager.start_kernel(cwd=str(root / "workspace"))
    client = manager.blocking_client()
    client.start_channels()
    stopping = False
    active_request_id = None
    canceled_requests = set()

    def control():
        nonlocal stopping
        heartbeat = root / "heartbeat"
        if (root / "shutdown").exists() or not heartbeat.exists() or time.time() - heartbeat.stat().st_mtime > 30:
            stopping = True
            return True
        interrupt = root / "interrupt"
        if interrupt.exists():
            canceled_id = json.loads(interrupt.read_text(encoding="utf-8")).get("id")
            interrupt.unlink(missing_ok=True)
            if not isinstance(canceled_id, str) or not canceled_id or len(canceled_id) > 80 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in canceled_id):
                raise ValueError("Invalid interruption identifier.")
            if canceled_id == active_request_id:
                manager.interrupt_kernel()
            elif not (root / f"response-{canceled_id}.json").exists():
                # Stop can arrive before the worker reads the queued request.
                # Retain its exact identity instead of interrupting an idle kernel.
                canceled_requests.add(canceled_id)
        return False

    try:
        client.wait_for_ready(timeout=30)
        publish(root / "ready.json", {"ok": True, "kernel": kernel_name})
        while not control():
            request_path = root / "request.json"
            if not request_path.exists():
                time.sleep(0.1)
                continue
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request_path.unlink()
            request_id = request.get("id", "")
            if not isinstance(request_id, str) or not request_id or len(request_id) > 80 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in request_id):
                raise ValueError("Invalid request identifier.")
            outputs = []
            display_ids = {}
            display_updates = []
            clear_pending = False
            execution_count = None
            result = {"outputs": outputs, "execution_count": execution_count, "status": "ok", "displayIDs": display_ids, "displayUpdates": display_updates}
            try:
                code = request.get("code")
                if not isinstance(code, str) or len(code.encode("utf-8")) > 1024 * 1024:
                    raise ValueError("A cell must contain at most 1 MiB of source.")
                if control():
                    raise RuntimeError("Kernel session closed.")
                if request_id in canceled_requests:
                    raise InterruptedError("Cell execution canceled before it started.")
                active_request_id = request_id
                message_id = client.execute(code, allow_stdin=False, stop_on_error=True)
                deadline = time.monotonic() + 120
                output_bytes = 0
                while True:
                    if control():
                        raise RuntimeError("Kernel session closed.")
                    if time.monotonic() > deadline:
                        manager.interrupt_kernel()
                        raise TimeoutError("Cell exceeded the two-minute execution limit. Restart the kernel before continuing.")
                    try:
                        message = client.get_iopub_msg(timeout=0.1)
                    except queue.Empty:
                        if not manager.is_alive():
                            raise RuntimeError("The kernel exited.")
                        continue
                    if message.get("parent_header", {}).get("msg_id") != message_id:
                        continue
                    kind, content = message["msg_type"], message["content"]
                    if kind == "status" and content["execution_state"] == "idle":
                        break
                    if kind == "execute_input":
                        execution_count = content["execution_count"]
                    elif kind == "clear_output":
                        clear_pending = bool(content.get("wait"))
                        if not clear_pending:
                            outputs.clear()
                            display_ids.clear()
                    elif kind in ("stream", "display_data", "execute_result", "error", "update_display_data"):
                        output = {"output_type": kind, **{key: value for key, value in content.items() if key not in ("transient",)}}
                        output_bytes += len(json.dumps(output).encode("utf-8"))
                        if output_bytes > 8 * 1024 * 1024:
                            manager.interrupt_kernel()
                            raise RuntimeError("Cell output exceeded 8 MiB. Restart the kernel before continuing.")
                        if clear_pending:
                            outputs.clear()
                            display_ids.clear()
                            clear_pending = False
                        display_id = content.get("transient", {}).get("display_id")
                        if kind == "update_display_data":
                            if isinstance(display_id, str):
                                update = {"displayID": display_id, "data": content.get("data", {}), "metadata": content.get("metadata", {})}
                                display_updates.append(update)
                                for index, previous_id in display_ids.items():
                                    if previous_id == display_id:
                                        outputs[index].update(data=update["data"], metadata=update["metadata"])
                        else:
                            if isinstance(display_id, str):
                                display_ids[len(outputs)] = display_id
                            outputs.append(output)
                        if kind == "error":
                            result["status"] = "error"
                result["execution_count"] = execution_count
            except Exception as error:
                result["status"] = "error"
                outputs.append({"output_type": "error", "ename": type(error).__name__, "evalue": str(error), "traceback": []})
                if isinstance(error, (TimeoutError, RuntimeError)):
                    stopping = True
            finally:
                active_request_id = None
                canceled_requests.discard(request_id)
            publish(root / f"response-{request_id}.json", result)
            if stopping:
                break
    finally:
        client.stop_channels()
        manager.shutdown_kernel(now=True)
        publish(root / "stopped.json", {"stopped": True})


if __name__ == "__main__":
    directory = Path(sys.argv[1]).resolve(strict=True)
    try:
        run(directory, sys.argv[2])
    except Exception as error:
        publish(directory / "ready.json", {"ok": False, "error": f"{type(error).__name__}: {error}"})
        sys.exit(1)
