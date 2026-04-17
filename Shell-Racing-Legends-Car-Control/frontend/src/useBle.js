import { useState, useRef, useCallback } from 'react'

const CONTROL_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb'
const CONTROL_CHAR = '0000fff1-0000-1000-8000-00805f9b34fb'
const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb'
const BATTERY_CHAR = '00002a19-0000-1000-8000-00805f9b34fb'

const NAME_FILTERS = [
  'SL-12Cilindri', 'SL-296 GT3', 'SL-296 GTB', 'SL-330 P4(1967)',
  'SL-488 Challenge Evo', 'SL-488 GTE', 'SL-499P', 'SL-499P N',
  'SL-Daytona SP3', 'SL-F1-75', 'SL-FXX-K Evo', 'SL-Purosangue',
  'SL-SF1000', 'SL-SF-23', 'SL-SF-24', 'SL-SF90 Spider',
  'SL-SF90 Spider N', 'SL-Shell Car',
]

export function useBle() {
  const [status, setStatus] = useState('disconnected') // disconnected | connecting | connected
  const [deviceName, setDeviceName] = useState('')
  const [battery, setBattery] = useState(null)
  const [error, setError] = useState('')

  const charRef = useRef(null)
  const deviceRef = useRef(null)
  const intervalRef = useRef(null)
  const stateRef = useRef({ w: false, a: false, s: false, d: false, lights: false, turbo: false, donut: false })

  const buildPacket = useCallback(() => {
    const s = stateRef.current
    return new Uint8Array([
      1,                    // mode
      s.w ? 1 : 0,         // forward
      s.s ? 1 : 0,         // reverse
      s.a ? 1 : 0,         // left
      s.d ? 1 : 0,         // right
      s.lights ? 1 : 0,    // lights
      s.turbo ? 1 : 0,     // turbo
      s.donut ? 1 : 0,     // donut
    ])
  }, [])

  const startSendLoop = useCallback(() => {
    if (intervalRef.current) return
    let running = true
    intervalRef.current = true
    ;(async () => {
      while (running) {
        if (charRef.current) {
          try {
            await charRef.current.writeValueWithoutResponse(buildPacket())
          } catch {
            // write failed, ignore transient errors
          }
        }
        await new Promise((r) => setTimeout(r, 50)) // ~20Hz, waits AFTER write completes
      }
    })()
    // Store cancel function so stopSendLoop can break the loop
    intervalRef.current = { stop: () => { running = false } }
  }, [buildPacket])

  const stopSendLoop = useCallback(() => {
    if (intervalRef.current?.stop) {
      intervalRef.current.stop()
      intervalRef.current = null
    }
  }, [])

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setError('Web Bluetooth is not supported in this browser. Use Chrome or Edge.')
      return
    }

    setError('')
    setStatus('connecting')

    try {
      const filters = NAME_FILTERS.map((name) => ({ namePrefix: name }))
      const device = await navigator.bluetooth.requestDevice({
        filters,
        optionalServices: [CONTROL_SERVICE, BATTERY_SERVICE],
      })

      deviceRef.current = device
      setDeviceName(device.name || 'Unknown')

      device.addEventListener('gattserverdisconnected', () => {
        stopSendLoop()
        charRef.current = null
        setStatus('disconnected')
        setBattery(null)
      })

      const server = await device.gatt.connect()

      // Get control characteristic
      const controlService = await server.getPrimaryService(CONTROL_SERVICE)
      const controlChar = await controlService.getCharacteristic(CONTROL_CHAR)
      charRef.current = controlChar

      // Try to read battery
      try {
        const batteryService = await server.getPrimaryService(BATTERY_SERVICE)
        const batteryChar = await batteryService.getCharacteristic(BATTERY_CHAR)
        const batteryVal = await batteryChar.readValue()
        setBattery(batteryVal.getUint8(0))
      } catch {
        // battery read optional
      }

      setStatus('connected')
      startSendLoop()
    } catch (err) {
      if (err.name === 'NotFoundError') {
        // User cancelled the device picker
        setStatus('disconnected')
        return
      }
      setError(err.message)
      setStatus('disconnected')
    }
  }, [startSendLoop, stopSendLoop])

  const disconnect = useCallback(async () => {
    stopSendLoop()
    charRef.current = null
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect()
    }
    deviceRef.current = null
    setStatus('disconnected')
    setDeviceName('')
    setBattery(null)
  }, [stopSendLoop])

  const updateState = useCallback((key, value) => {
    stateRef.current[key] = value
  }, [])

  return { status, deviceName, battery, error, connect, disconnect, updateState }
}
