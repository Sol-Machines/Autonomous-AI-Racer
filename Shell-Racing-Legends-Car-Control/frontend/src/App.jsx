import { useState, useEffect, useCallback, useRef } from 'react'
import { useBle } from './useBle'
import { useWhep } from './useWhep'
import { useBackend } from './useBackend'

function App() {
  const [lights, setLights] = useState(false)
  const [turbo, setTurbo] = useState(false)
  const [donut, setDonut] = useState(false)
  const [activeKeys, setActiveKeys] = useState(new Set())
  const [cameraUrl, setCameraUrl] = useState(() => localStorage.getItem('cameraUrl') || '')
  const [backendUrl, setBackendUrl] = useState(() => localStorage.getItem('backendUrl') || '')

  const ble = useBle()
  const cam = useWhep(cameraUrl)
  const backend = useBackend()

  const isRemote = backend.status === 'connected'

  // Auto-connect to saved backend on mount
  const connectRef = useRef(backend.connect)
  connectRef.current = backend.connect
  useEffect(() => {
    const saved = localStorage.getItem('backendUrl')
    if (saved) connectRef.current(saved)
  }, [])

  // Auto-start camera when Pi comes online in remote mode
  useEffect(() => {
    if (isRemote && backend.piOnline && backend.cameraStatus === 'disconnected') {
      backend.startCamera()
    }
  }, [isRemote, backend.piOnline, backend.cameraStatus, backend.startCamera])

  // Unified car status
  const carConnected = isRemote ? backend.car.connected : ble.status === 'connected'
  const carConnecting = isRemote ? backend.car.scanning : ble.status === 'connecting'
  const carName = isRemote ? backend.car.name : ble.deviceName
  const carBattery = isRemote ? backend.car.battery : ble.battery
  const carError = isRemote ? backend.car.error : ble.error

  // Unified camera status
  const camConnected = isRemote ? backend.cameraStatus === 'connected' : cam.status === 'connected'
  const camLatency = isRemote ? backend.latency : cam.latency
  const camVideoRef = isRemote ? backend.videoRef : cam.videoRef
  const camDisconnect = isRemote ? backend.stopCamera : cam.disconnect

  const handleBackendConnect = useCallback(() => {
    localStorage.setItem('backendUrl', backendUrl)
    backend.connect(backendUrl)
  }, [backendUrl, backend])

  const handleBackendDisconnect = useCallback(() => {
    localStorage.removeItem('backendUrl')
    setBackendUrl('')
    backend.disconnect()
  }, [backend])

  const handleCameraConnect = useCallback(() => {
    localStorage.setItem('cameraUrl', cameraUrl)
    if (cam.status === 'connected' || cam.status === 'connecting') {
      cam.disconnect()
    } else {
      cam.connect()
    }
  }, [cameraUrl, cam])

  const handleCarToggle = useCallback(() => {
    if (isRemote) {
      if (carConnected) backend.disconnectCar()
      else backend.connectCar()
    } else {
      if (ble.status === 'connected') ble.disconnect()
      else ble.connect()
    }
  }, [isRemote, carConnected, backend, ble])

  const handleKeyDown = useCallback((e) => {
    const key = e.key.toLowerCase()
    setActiveKeys((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    const update = isRemote ? backend.updateState : ble.updateState
    if (['w', 'a', 's', 'd'].includes(key)) {
      update(key, true)
    }
    if (key === 'l') setLights((v) => { const nv = !v; update('lights', nv); return nv })
    if (key === 't') setTurbo((v) => { const nv = !v; update('turbo', nv); return nv })
    if (key === 'o') setDonut((v) => { const nv = !v; update('donut', nv); return nv })
  }, [ble, backend.updateState, isRemote])

  const handleKeyUp = useCallback((e) => {
    const key = e.key.toLowerCase()
    setActiveKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    const update = isRemote ? backend.updateState : ble.updateState
    if (['w', 'a', 's', 'd'].includes(key)) {
      update(key, false)
    }
  }, [ble, backend.updateState, isRemote])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleKeyDown, handleKeyUp])

  const toggleLights = () => {
    const update = isRemote ? backend.updateState : ble.updateState
    setLights((v) => { const nv = !v; update('lights', nv); return nv })
  }
  const toggleTurbo = () => {
    const update = isRemote ? backend.updateState : ble.updateState
    setTurbo((v) => { const nv = !v; update('turbo', nv); return nv })
  }
  const toggleDonut = () => {
    const update = isRemote ? backend.updateState : ble.updateState
    setDonut((v) => { const nv = !v; update('donut', nv); return nv })
  }

  const isPressed = (key) => activeKeys.has(key)

  return (
    <div className="h-screen w-screen bg-black text-white select-none overflow-hidden relative">
      {/* Full-screen Camera Feed */}
      <div className="absolute inset-0 bg-black">
        {/* Video (works for both remote and local) */}
        {camConnected && (
          <video
            ref={camVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain rotate-180"
          />
        )}

        {/* Remote — waiting for Pi or camera */}
        {isRemote && !camConnected && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-white/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <p className="text-white/20 text-sm font-medium">
                {!backend.piOnline
                  ? 'Waiting for Pi to come online…'
                  : backend.cameraStatus === 'connecting'
                    ? 'Connecting to camera…'
                    : 'Camera disconnected'}
              </p>
            </div>
          </div>
        )}

        {/* Not connected — show connection screen */}
        {!isRemote && !camConnected && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-white/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <p className="text-white/20 text-sm font-medium mb-6">
                {backend.status === 'connecting' ? 'Connecting to backend…' : 'Not connected'}
              </p>

              {/* Backend URL */}
              <div className="mb-4">
                <p className="text-white/30 text-xs mb-2 uppercase tracking-wider">Remote Control</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="http://backend:3000"
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/30 outline-none focus:border-white/40 w-48"
                  />
                  <button
                    onClick={handleBackendConnect}
                    disabled={!backendUrl || backend.status === 'connecting'}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {backend.status === 'connecting' ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 my-5">
                <div className="h-px bg-white/10 flex-1" />
                <span className="text-white/20 text-xs">or direct</span>
                <div className="h-px bg-white/10 flex-1" />
              </div>

              {/* Direct camera URL */}
              <div>
                <p className="text-white/30 text-xs mb-2 uppercase tracking-wider">Camera Only</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="http://pi-ip:1984"
                    value={cameraUrl}
                    onChange={(e) => setCameraUrl(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/30 outline-none focus:border-white/40 w-48"
                  />
                  <button
                    onClick={handleCameraConnect}
                    disabled={!cameraUrl || cam.status === 'connecting'}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Connect
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* HUD Overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top Bar */}
        <header className="pointer-events-auto w-full px-5 py-4 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
          <div>
            <h1 className="text-xl font-bold tracking-tight drop-shadow-lg">
              <span className="text-red-500">Sol</span> Machines
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Latency */}
            {camConnected && camLatency != null && (
              <div className="flex items-center gap-1.5 text-sm text-white/70 drop-shadow">
                <span className="font-mono text-xs">{camLatency}ms</span>
              </div>
            )}
            {/* Cam button */}
            {camConnected && (
              <button
                onClick={camDisconnect}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/10 border border-white/20 text-white/60 hover:bg-white/20 cursor-pointer backdrop-blur-sm"
              >
                Cam
                <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              </button>
            )}
            {/* Backend indicator + disconnect */}
            {isRemote && (
              <button
                onClick={handleBackendDisconnect}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/10 border border-white/20 text-white/60 hover:bg-white/20 cursor-pointer backdrop-blur-sm"
              >
                Backend
                <span className={`ml-1.5 inline-block w-2 h-2 rounded-full ${backend.piOnline ? 'bg-green-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
              </button>
            )}
            {/* Battery */}
            {carConnected && carBattery != null && (
              <div className="flex items-center gap-1.5 text-sm text-white/70 drop-shadow">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 10.5h.375c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125H21M3.75 18h15A2.25 2.25 0 0 0 21 15.75v-6a2.25 2.25 0 0 0-2.25-2.25h-15A2.25 2.25 0 0 0 1.5 9.75v6A2.25 2.25 0 0 0 3.75 18Z" />
                </svg>
                {carBattery}%
              </div>
            )}
            {/* Car name */}
            {carConnected && carName && (
              <span className="text-xs text-white/40 hidden sm:block drop-shadow">{carName}</span>
            )}
            {/* Connect / Disconnect car */}
            <button
              onClick={handleCarToggle}
              disabled={carConnecting}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-wait backdrop-blur-sm
                ${carConnected
                  ? 'bg-white/10 border border-white/20 text-white/80 hover:bg-white/20'
                  : 'bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-600/30'
                }`}
            >
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${carConnected ? 'bg-green-400 animate-pulse' : carConnecting ? 'bg-amber-400 animate-pulse' : 'bg-neutral-500'}`} />
                {carConnecting ? (isRemote ? 'Scanning…' : 'Connecting…') : carConnected ? 'Disconnect' : 'Connect Car'}
              </span>
            </button>
          </div>
        </header>

        {/* Error Banner */}
        {carError && (
          <div className="pointer-events-auto px-5 mt-1">
            <p className="text-red-400 text-xs bg-red-500/10 backdrop-blur-sm border border-red-500/20 rounded-lg px-3 py-2 inline-block">{carError}</p>
          </div>
        )}

        {/* Bottom HUD */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-5 bg-gradient-to-t from-black/70 to-transparent pt-16">
          <div className="flex items-end justify-between">
            {/* WASD - bottom left */}
            <div className="pointer-events-auto">
              <div className="flex flex-col items-center gap-1.5">
                <Key label="W" sub="FWD" active={isPressed('w')} />
                <div className="flex gap-1.5">
                  <Key label="A" sub="LEFT" active={isPressed('a')} />
                  <Key label="S" sub="REV" active={isPressed('s')} />
                  <Key label="D" sub="RIGHT" active={isPressed('d')} />
                </div>
              </div>
            </div>

            {/* Keybind hints - bottom center */}
            <div className="hidden md:block pb-1">
              <p className="text-white/30 text-xs text-center">
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/50 text-[10px] font-mono">WASD</kbd> drive
                &nbsp;&middot;&nbsp;
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/50 text-[10px] font-mono">L</kbd> lights
                &nbsp;&middot;&nbsp;
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/50 text-[10px] font-mono">T</kbd> turbo
                &nbsp;&middot;&nbsp;
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/50 text-[10px] font-mono">O</kbd> donut
              </p>
            </div>

            {/* Toggle buttons - bottom right */}
            <div className="pointer-events-auto flex flex-col gap-2">
              <ToggleButton
                label="Lights"
                hotkey="L"
                active={lights}
                onClick={toggleLights}
                activeColor="bg-amber-500"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                  </svg>
                }
              />
              <ToggleButton
                label="Turbo"
                hotkey="T"
                active={turbo}
                onClick={toggleTurbo}
                activeColor="bg-red-500"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
                  </svg>
                }
              />
              <ToggleButton
                label="Donut"
                hotkey="O"
                active={donut}
                onClick={toggleDonut}
                activeColor="bg-purple-500"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992" />
                  </svg>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Key({ label, sub, active }) {
  return (
    <div
      className={`w-14 h-14 rounded-xl border flex flex-col items-center justify-center transition-all duration-100 backdrop-blur-md
        ${active
          ? 'bg-red-500/30 border-red-500/60 text-red-400 scale-95 shadow-lg shadow-red-500/30'
          : 'bg-white/10 border-white/20 text-white/80'
        }`}
    >
      <span className="text-lg font-bold leading-none">{label}</span>
      <span className="text-[9px] mt-1 opacity-60 uppercase">{sub}</span>
    </div>
  )
}

function ToggleButton({ label, hotkey, active, onClick, activeColor, icon }) {
  return (
    <button
      onClick={onClick}
      className={`w-44 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all duration-150 cursor-pointer backdrop-blur-md
        ${active
          ? `${activeColor} border-transparent text-white shadow-lg`
          : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
        }`}
    >
      {icon}
      <span className="font-semibold flex-1 text-left text-sm">{label}</span>
      <kbd className={`text-xs font-mono px-1.5 py-0.5 rounded ${active ? 'bg-white/20' : 'bg-white/10'}`}>
        {hotkey}
      </kbd>
      <div className={`w-2.5 h-2.5 rounded-full transition-colors ${active ? 'bg-white' : 'bg-white/30'}`} />
    </button>
  )
}

export default App
