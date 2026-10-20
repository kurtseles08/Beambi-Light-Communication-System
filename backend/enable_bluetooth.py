"""Enable the laptop Bluetooth radio for BeamBi battery telemetry."""
import asyncio
from winrt.windows.devices.radios import Radio, RadioKind, RadioState


async def main():
    access = await Radio.request_access_async()
    print(f'Bluetooth setting access: {access}')
    for radio in await Radio.get_radios_async():
        if radio.kind == RadioKind.BLUETOOTH:
            result = await radio.set_state_async(RadioState.ON)
            print(f'{radio.name}: {result}; state={radio.state}')


asyncio.run(main())
