import asyncio
from bleak import BleakClient
import evdev
from evdev import ecodes

ADDRESS = "0A:C0:31:24:F9:C1"
CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"

# key state
keys = {
    "w": False,
    "a": False,
    "s": False,
    "d": False
}

# toggle state
lights = False
turbo = False
donut = False

KEY_MAP = {
    ecodes.KEY_W: "w",
    ecodes.KEY_A: "a",
    ecodes.KEY_S: "s",
    ecodes.KEY_D: "d",
}

TOGGLE_MAP = {
    ecodes.KEY_L: "lights",
    ecodes.KEY_T: "turbo",
    ecodes.KEY_O: "donut",
}


def build_packet():
    return bytes([
        1,                              # mode (1 = normal)
        1 if keys["w"] else 0,          # forward
        1 if keys["s"] else 0,          # reverse
        1 if keys["a"] else 0,          # left
        1 if keys["d"] else 0,          # right
        int(lights),                    # lights
        int(turbo),                     # turbo
        int(donut),                     # donut
    ])


def find_keyboard():
    devices = [evdev.InputDevice(path) for path in evdev.list_devices()]
    for dev in devices:
        caps = dev.capabilities(verbose=False)
        if ecodes.EV_KEY in caps and ecodes.KEY_W in caps[ecodes.EV_KEY]:
            print(f"Using keyboard: {dev.name} ({dev.path})")
            return dev
    raise RuntimeError("No keyboard found. Make sure you're in the 'input' group or run with sudo.")


async def keyboard_loop(device):
    global lights, turbo, donut
    async for event in device.async_read_loop():
        if event.type == ecodes.EV_KEY:
            if event.code in KEY_MAP:
                key_name = KEY_MAP[event.code]
                if event.value == 1:  # key down
                    keys[key_name] = True
                elif event.value == 0:  # key up
                    keys[key_name] = False
            elif event.code in TOGGLE_MAP and event.value == 1:  # toggle on press
                name = TOGGLE_MAP[event.code]
                if name == "lights":
                    lights = not lights
                    print(f"Lights {'ON' if lights else 'OFF'}")
                elif name == "turbo":
                    turbo = not turbo
                    print(f"Turbo {'ON' if turbo else 'OFF'}")
                elif name == "donut":
                    donut = not donut
                    print(f"Donut {'ON' if donut else 'OFF'}")


async def control_loop(client):
    while True:
        packet = build_packet()
        await client.write_gatt_char(CHAR_UUID, packet, response=False)
        await asyncio.sleep(0.05)  # ~20Hz


async def main():
    device = find_keyboard()
    async with BleakClient(ADDRESS) as client:
        print("Connected:", client.is_connected)
        print("Use WASD to control the car. L=lights, T=turbo, O=donut. Ctrl+C to exit.")

        await asyncio.gather(
            keyboard_loop(device),
            control_loop(client),
        )


if __name__ == "__main__":
    asyncio.run(main())