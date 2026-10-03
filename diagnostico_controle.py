"""Abre o painel e registra suas confirmacoes para conferir o teste manual."""
import json
import time
from pathlib import Path

from controle_reles import Panel, tk

root = tk.Tk()
panel = Panel(root)
log_path = Path(__file__).with_name("diagnostico_controle.jsonl")
log_file = log_path.open("w", encoding="utf-8", buffering=1)
previous = None


def record(*_):
    global previous
    status = panel.status.get()
    if status == previous:
        return
    previous = status
    log_file.write(json.dumps({"hora": time.strftime("%H:%M:%S"),
                               "status": status, "conectado": panel.ready,
                               "comando": panel.holding}, ensure_ascii=False) + "\n")


panel.status.trace_add("write", record)
record()
try:
    root.mainloop()
finally:
    log_file.close()
