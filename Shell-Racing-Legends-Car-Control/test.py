import asyncio
from bleak import BleakScanner, BleakClient
from bleak.exc import BleakDBusError

SCAN_TIME = 8  # seconds
SCAN_RETRIES = 3
SCAN_RETRY_DELAY = 2
CHAR_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"  # placeholder
TEST_PACKET = bytearray([0x01, 0x00, 0x00, 0x00])


async def scan_devices(label):
    print(f"\n--- Scanning ({label}) for {SCAN_TIME}s ---")

    for attempt in range(1, SCAN_RETRIES + 1):
        try:
            devices = await BleakScanner.discover(timeout=SCAN_TIME)
            break
        except BleakDBusError as error:
            if "org.bluez.Error.InProgress" not in str(error):
                raise

            if attempt == SCAN_RETRIES:
                raise RuntimeError(
                    "Bluetooth scan is already in progress. Stop other scans with "
                    "'bluetoothctl scan off', close Bluetooth manager apps, or run "
                    "'sudo systemctl restart bluetooth' and try again."
                ) from error

            print("Bluetooth scan already in progress. Waiting and retrying...")
            await asyncio.sleep(SCAN_RETRY_DELAY)

    result = {}
    for d in devices:
        name = d.name or "Unknown"
        result[d.address] = name
        print(f"{name} - {d.address}")

    return result


def find_candidates(on_devices, off_devices):
    print("\n--- Analysing differences ---")

    candidates = {}

    for addr, name in on_devices.items():
        if addr not in off_devices:
            candidates[addr] = name

    if not candidates:
        print("No clear candidates found (device may always advertise).")
        print("Falling back to all 'ON' devices.")
        return on_devices

    print("\nPossible car devices (disappeared when OFF):")
    for i, (addr, name) in enumerate(candidates.items()):
        print(f"[{i}] {name} - {addr}")

    return candidates


async def connect_and_test(address):
    print(f"\nConnecting to {address}...")

    try:
        async with BleakClient(address) as client:
            print("Connected:", client.is_connected)

            print("\nServices + characteristics:")
            for service in client.services:
                print(service.uuid)
                for char in service.characteristics:
                    print(f"  └─ {char.uuid} | {char.properties}")

            print("\nSending test packet...")
            await client.write_gatt_char(CHAR_UUID, TEST_PACKET)

            print("Packet sent successfully (if UUID is correct)")

    except Exception as e:
        print("Connection or write failed:", e)


async def main():
    print("STEP 1: Turn the car ON")
    input("Press ENTER when ready...")

    on_devices = await scan_devices("car ON")

    print("\nSTEP 2: Turn the car OFF")
    input("Press ENTER when ready...")

    off_devices = await scan_devices("car OFF")

    candidates = find_candidates(on_devices, off_devices)

    # Let user choose
    candidate_list = list(candidates.items())

    print("\nSelect device to connect:")
    for i, (addr, name) in enumerate(candidate_list):
        print(f"[{i}] {name} - {addr}")

    choice = int(input("Enter number: "))
    address = candidate_list[choice][0]

    await connect_and_test(address)


if __name__ == "__main__":
    asyncio.run(main())