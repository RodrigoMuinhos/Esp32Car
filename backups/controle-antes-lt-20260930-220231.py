"""RB ou RT/K1, LB/K2, direita/K3 e esquerda/K4. Eixos simultaneos."""
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


class WheelMapping:
    def __init__(self):
        self.armed = False
        self.turn = 0
        self.rt_pressed = False

    def read(self, connected, buttons=0, lx=0, rt=0):
        if not connected:
            self.armed = False
            self.turn = 0
            self.rt_pressed = False
            return 0
        shoulders = buttons & 768
        if not self.armed:
            if not shoulders and abs(lx) <= 2500 and rt <= 15:
                self.armed = True
            return 0
        # Histerese: liga a 15% do curso e desliga perto do centro (8%).
        if lx >= 5000:
            self.turn = 3
        elif lx <= -5000:
            self.turn = 4
        elif (self.turn == 3 and lx <= 2500) or (self.turn == 4 and lx >= -2500):
            self.turn = 0
        if rt >= 30:
            self.rt_pressed = True
        elif rt <= 15:
            self.rt_pressed = False
        # RB ou RT acelera; acelerar e frear juntos cancela apenas esse eixo.
        accelerate = bool(buttons & 512) or self.rt_pressed
        brake = bool(buttons & 256)
        drive = 1 if accelerate and not brake else 2 if brake and not accelerate else 0
        steering = (1 << (self.turn - 1)) if self.turn else 0
        return drive | steering


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
        self.holding = 0
        self.mapping = WheelMapping()
        self.last_hold = 0
        self.last_ack = 0
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
        tk.Label(root, text="RB/RT → K1 · LB → K2 · Direita K3 / esquerda K4",
                 bg="#152033", fg="#bccbe0").pack()
        bar = ttk.Frame(root)
        bar.pack(pady=15)
        self.port_name = tk.StringVar(value="COM7")
        ttk.Entry(bar, textvariable=self.port_name, width=9).pack(side="left", padx=5)
        self.connect_button = ttk.Button(bar, text="Conectar ESP32", command=self.connect)
        self.connect_button.pack(side="left", padx=5)
        pad = tk.Frame(root, bg="#152033")
        pad.pack()
        for number, label, row, column in [(1, "▲\nK1 · RB / RT", 0, 1),
                                          (2, "▼\nK2 · LB", 2, 1),
                                          (3, "▶\nK3 · Direita", 1, 2),
                                          (4, "◀\nK4 · Esquerda", 1, 0)]:
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
        tk.Label(root, text="Acelere ou freie enquanto gira · Soltar desliga",
                 bg="#152033", fg="#bccbe0").pack(pady=5)
        root.bind("<KeyPress>", self.key_down)
        root.bind("<KeyRelease>", lambda event: self.keys.discard(event.keysym))
        root.bind("<FocusOut>", lambda event: self.keys.clear())
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.tick()
        root.after(300, self.connect)

    def connect(self):
        if self.port:
            self.disconnect("Desconectado")
            return
        try:
            self.port = serial.Serial(self.port_name.get().strip(), 115200, timeout=0,
                                      write_timeout=0.2)
            self.buffer = b""
            self.ready = False
            self.mapping = WheelMapping()
            self.deadline = time.monotonic() + 10
            self.connect_button.configure(text="Desconectar")
            self.status.set("Conectado; aguardando o ESP32 iniciar…")
        except (serial.SerialException, OSError) as error:
            self.disconnect(f"Erro: {error}")

    def disconnect(self, message):
        if self.port:
            try:
                self.port.write(b'S')
            except (serial.SerialException, OSError):
                pass
            self.port.close()
        self.holding = 0
        self.mapping = WheelMapping()
        self.port = None
        self.ready = False
        self.pending = None
        self.connect_button.configure(text="Conectar ESP32")
        self.status.set(message)

    def key_down(self, event):
        mapping = {"Up": 1, "Down": 2, "Left": 4, "Right": 3}
        if event.keysym in mapping and event.keysym not in self.keys:
            self.keys.add(event.keysym)
            self.trigger(mapping[event.keysym])
            return "break"

    def trigger(self, number):
        if not self.port or not self.ready:
            self.status.set("Conecte o ESP32 e aguarde a mensagem Pronto.")
            return
        if self.holding or self.pending is not None or time.monotonic() < self.busy_until:
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
                    if text == "Pronto CONTROLE v5":
                        self.ready = True
                        self.status.set("Pronto — escolha uma direção")
                    if text.startswith("ESTADO "):
                        try:
                            mask = int(text.split()[1])
                        except (ValueError, IndexError):
                            continue
                        if not 0 <= mask <= 15:
                            continue
                        if mask == self.holding:
                            self.last_ack = now
                        for number, button in self.buttons.items():
                            button.configure(bg="#238263" if mask & (1 << (number - 1)) else "#29405f")
                        active = " + ".join(f"K{n}" for n in range(1, 5) if mask & (1 << (n - 1)))
                        self.status.set("ESP32 confirmou: " + (active + " ligados" if active else "relés desligados"))
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
        state = State()
        connected = bool(self.xinput and self.xinput.XInputGetState(0, ctypes.byref(state)) == 0)
        desired = self.mapping.read(connected, state.pad.buttons, state.pad.lx, state.pad.rt)
        if self.ready and self.port:
            try:
                if desired != self.holding:
                    # Atualiza ambos os eixos de uma vez, sem desligar a direcao mantida.
                    self.port.write(bytes([ord('a') + desired]))
                    self.holding = desired
                    self.pending = None
                    self.last_ack = now
                    self.last_hold = now
                if self.holding:
                    if now - self.last_ack > 1.5:
                        self.disconnect("Sem resposta; controle desligado. Reconecte.")
                    elif now - self.last_hold >= 0.15:
                        self.port.write(bytes([ord('a') + self.holding]))
                        self.last_hold = now
            except (serial.SerialException, OSError) as error:
                self.disconnect(f"Erro serial: {error}")
        else:
            self.mapping = WheelMapping()
        self.gamepad_status.set(
            f"Centralize e solte RB, RT e LB para iniciar"
            if connected and not self.mapping.armed else
            f"Volante conectado · Giro: {state.pad.lx} · RT: {state.pad.rt}" if connected else
            "Volante não detectado · use mouse ou teclado")
        self.root.after(25, self.tick)

    def close(self):
        self.disconnect("Encerrado")
        self.root.destroy()


if __name__ == "__main__":
    window = tk.Tk()
    Panel(window)
    window.mainloop()
