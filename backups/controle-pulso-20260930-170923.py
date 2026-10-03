"""Painel local: um pulso de 500 ms por acionamento, sem repeticao ao segurar."""
import ctypes
import time
import tkinter as tk
from tkinter import ttk

import serial


class Gamepad(ctypes.Structure):
    _fields_ = [("buttons", ctypes.c_ushort), ("lt", ctypes.c_ubyte),
                ("rt", ctypes.c_ubyte), ("lx", ctypes.c_short),
                ("ly", ctypes.c_short), ("rx", ctypes.c_short), ("ry", ctypes.c_short)]


class State(ctypes.Structure):
    _fields_ = [("packet", ctypes.c_uint32), ("pad", Gamepad)]


class Panel:
    def __init__(self, root):
        self.root = root
        self.port = None
        self.ready = False
        self.pending = None
        self.deadline = 0
        self.busy_until = 0
        self.buffer = b""
        self.keys = set()
        self.previous = {}
        self.buttons = {}
        try:
            self.xinput = ctypes.WinDLL("xinput1_4.dll")
            self.xinput.XInputGetState.argtypes = [ctypes.c_uint32, ctypes.POINTER(State)]
            self.xinput.XInputGetState.restype = ctypes.c_uint32
        except OSError:
            self.xinput = None

        root.title("Controle dos relés")
        root.geometry("440x440")
        root.resizable(False, False)
        root.configure(bg="#152033")
        tk.Label(root, text="CONTROLE DOS RELÉS", font=("Segoe UI", 18, "bold"),
                 bg="#152033", fg="white").pack(pady=(20, 5))
        tk.Label(root, text="Clique • Setas do teclado • Direcional do volante",
                 bg="#152033", fg="#bccbe0").pack()
        bar = ttk.Frame(root)
        bar.pack(pady=15)
        self.port_name = tk.StringVar(value="COM7")
        ttk.Entry(bar, textvariable=self.port_name, width=9).pack(side="left", padx=5)
        self.connect_button = ttk.Button(bar, text="Conectar ESP32", command=self.connect)
        self.connect_button.pack(side="left", padx=5)
        pad = tk.Frame(root, bg="#152033")
        pad.pack()
        for number, label, row, column in [(1, "▲\nK1 · Cima", 0, 1),
                                          (2, "▼\nK2 · Baixo", 2, 1),
                                          (3, "◀\nK3 · Esquerda", 1, 0),
                                          (4, "▶\nK4 · Direita", 1, 2)]:
            button = tk.Button(pad, text=label, width=12, height=3,
                               font=("Segoe UI", 10, "bold"), bg="#29405f", fg="white",
                               activebackground="#347bd1", activeforeground="white",
                               command=lambda n=number: self.trigger(n))
            button.grid(row=row, column=column, padx=3, pady=3)
            self.buttons[number] = button
        self.status = tk.StringVar(value="Desconectado — clique em Conectar ESP32")
        tk.Label(root, textvariable=self.status, bg="#152033", fg="#8ddbc1",
                 wraplength=420).pack(pady=(12, 5))
        self.gamepad_status = tk.StringVar(value="Procurando volante…")
        tk.Label(root, textvariable=self.gamepad_status, bg="#152033", fg="#bccbe0").pack()
        tk.Label(root, text="Um relé por vez · Pulso de 0,5 s · Sem repetição",
                 bg="#152033", fg="#bccbe0").pack(pady=5)
        root.bind("<KeyPress>", self.key_down)
        root.bind("<KeyRelease>", lambda event: self.keys.discard(event.keysym))
        root.bind("<FocusOut>", lambda event: self.keys.clear())
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.tick()

    def connect(self):
        if self.port:
            self.disconnect("Desconectado")
            return
        try:
            self.port = serial.Serial(self.port_name.get().strip(), 115200, timeout=0,
                                      write_timeout=0.2)
            self.buffer = b""
            self.ready = False
            self.deadline = time.monotonic() + 10
            self.connect_button.configure(text="Desconectar")
            self.status.set("Conectado; aguardando o ESP32 iniciar…")
        except (serial.SerialException, OSError) as error:
            self.disconnect(f"Erro: {error}")

    def disconnect(self, message):
        if self.port:
            self.port.close()
        self.port = None
        self.ready = False
        self.pending = None
        self.connect_button.configure(text="Conectar ESP32")
        self.status.set(message)

    def key_down(self, event):
        mapping = {"Up": 1, "Down": 2, "Left": 3, "Right": 4}
        if event.keysym in mapping and event.keysym not in self.keys:
            self.keys.add(event.keysym)
            self.trigger(mapping[event.keysym])
            return "break"

    def trigger(self, number):
        if not self.port or not self.ready:
            self.status.set("Conecte o ESP32 e aguarde a mensagem Pronto.")
            return
        if self.pending is not None or time.monotonic() < self.busy_until:
            return
        try:
            self.port.write(str(number).encode("ascii"))
            self.pending = number
            self.deadline = time.monotonic() + 3
            self.status.set(f"Comando K{number} enviado; aguardando confirmação…")
        except (serial.SerialException, OSError) as error:
            self.disconnect(f"Erro: {error}")

    def tick(self):
        now = time.monotonic()
        if self.port:
            try:
                self.buffer += self.port.read(4096)
                while b"\n" in self.buffer:
                    line, self.buffer = self.buffer.split(b"\n", 1)
                    text = line.decode("utf-8", errors="replace").strip()
                    if text == "Pronto. Envie 1, 2, 3 ou 4 para testar.":
                        self.ready = True
                        self.status.set("Pronto — escolha uma direção")
                    if self.pending is not None and text == f"Testando rele {self.pending}":
                        number = self.pending
                        self.pending = None
                        self.busy_until = now + 0.65
                        self.status.set(f"ESP32 confirmou K{number} — pulso de 0,5 s")
                        self.buttons[number].configure(bg="#238263")
                        self.root.after(650, lambda n=number: self.buttons[n].configure(bg="#29405f"))
                if len(self.buffer) > 8192:
                    self.buffer = b""
                if (not self.ready or self.pending is not None) and now > self.deadline:
                    self.disconnect("Sem confirmação do ESP32. Verifique a conexão e o programa.")
            except (serial.SerialException, OSError) as error:
                self.disconnect(f"Erro serial: {error}")
        found = []
        if self.xinput:
            for index in range(4):
                state = State()
                if self.xinput.XInputGetState(index, ctypes.byref(state)) != 0:
                    self.previous.pop(index, None)
                    continue
                found.append(index)
                current = state.pad.buttons
                old = self.previous.get(index, current)
                self.previous[index] = current
                # Exige uma unica direcao; diagonais nao geram dois comandos.
                direction = current & 15
                if direction in (1, 2, 4, 8) and direction & ~old:
                    if self.root.focus_displayof() is not None:
                        self.trigger({1: 1, 2: 2, 4: 3, 8: 4}[direction])
        self.gamepad_status.set("Volante conectado · mantenha esta janela em foco" if found
                                else "Volante não detectado · use mouse ou teclado")
        self.root.after(25, self.tick)

    def close(self):
        self.disconnect("Encerrado")
        self.root.destroy()


if __name__ == "__main__":
    window = tk.Tk()
    Panel(window)
    window.mainloop()
