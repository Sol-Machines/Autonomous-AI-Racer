import asyncio
from bleak import BleakClient

ADDRESS = "0A:C0:31:24:F5:B5"

CHARS = {
    "fff1": "0000fff1-0000-1000-8000-00805f9b34fb",
    "fff2": "0000fff2-0000-1000-8000-00805f9b34fb",
    "fe01": "0000fe01-0000-1000-8000-00805f9b34fb",
}

# Common "start engine" init packets to try
INIT_PACKETS = [
    ("START", bytearray(b"START")),
    ("0x01", bytearray([0x01])),
    ("0x01 padded 16", bytearray([0x01]) + bytearray(15)),
    ("CTL header", bytearray(b"CTL") + bytearray(13)),
    ("0xFF", bytearray([0xFF])),
    ("0x01 0x01", bytearray([0x01, 0x01])),
    ("forward test", bytearray([0x01, 0x00, 0x00, 0x00])),
]


def notification_handler(char_uuid):
    def handler(sender, data):
        print(f"  NOTIFY [{char_uuid}]: {data.hex()} ({data})")
    return handler


async def main():
    async with BleakClient(ADDRESS) as client:
        print("Connected:", client.is_connected)

        # Subscribe to all notifiable characteristics
        print("\n--- Subscribing to notifications ---")
        for name, uuid in CHARS.items():
            try:
                await client.start_notify(uuid, notification_handler(name))
                print(f"  Subscribed to {name}")
            except Exception as e:
                print(f"  Can't subscribe to {name}: {e}")

        # Wait for any initial notifications
        print("\nWaiting 2s for initial notifications...")
        await asyncio.sleep(2)

        # Try init packets on both writable characteristics
        for char_name in ["fff1", "fe01"]:
            uuid = CHARS[char_name]
            print(f"\n--- Testing writes to {char_name} ---")

            for label, packet in INIT_PACKETS:
                try:
                    await client.write_gatt_char(uuid, packet, response=False)
                    print(f"  Sent '{label}': {packet.hex()}")
                    await asyncio.sleep(1)  # wait for car reaction + notifications
                except Exception as e:
                    print(f"  Failed '{label}': {e}")

        # After init attempts, try a "forward" control packet
        print("\n--- Trying forward drive after each init ---")
        forward = bytearray(16)
        forward[1] = 1  # forward

        for char_name in ["fff1", "fe01"]:
            uuid = CHARS[char_name]
            print(f"\n  Driving forward on {char_name} for 2s...")
            for _ in range(40):  # 2 seconds at 20Hz
                await client.write_gatt_char(uuid, forward, response=False)
                await asyncio.sleep(0.05)
            print(f"  Stopped.")
            await asyncio.sleep(1)

        print("\nDone. Check if the car moved at any point.")


if __name__ == "__main__":
    asyncio.run(main())
