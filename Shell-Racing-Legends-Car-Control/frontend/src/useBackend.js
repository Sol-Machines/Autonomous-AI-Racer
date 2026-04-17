import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Single hook that connects to the backend WebSocket and provides
 * unified car control + camera streaming via the Pi agent relay.
 */
export function useBackend() {
  // ── State ──────────────────────────────────────────────────
  const [status, setStatus] = useState('disconnected')      // backend WS
  const [piOnline, setPiOnline] = useState(false)
  const [car, setCar] = useState({ connected: false, name: '', battery: null, error: '', scanning: false })
  const [cameraStatus, setCameraStatus] = useState('disconnected')
  const [latency, setLatency] = useState(null)

  // ── Refs ───────────────────────────────────────────────────
  const wsRef = useRef(null)
  const pcRef = useRef(null)
  const videoElRef = useRef(null)
  const streamRef = useRef(null)
  const statsRef = useRef(null)
  const urlRef = useRef('')
  const controlRef = useRef({ forward: 0, reverse: 0, left: 0, right: 0, lights: 0, turbo: 0, donut: 0 })
  const reconnectRef = useRef(null)
  const cameraRetryRef = useRef(null)

  // Callback ref for <video> (solves race between ontrack and mount)
  const videoRef = useCallback((el) => {
    videoElRef.current = el
    if (el && streamRef.current) el.srcObject = streamRef.current
  }, [])

  // ── Send helper ────────────────────────────────────────────
  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  // ── Cleanup helpers ────────────────────────────────────────
  const cleanupCamera = useCallback(() => {
    if (cameraRetryRef.current) { clearTimeout(cameraRetryRef.current); cameraRetryRef.current = null }
    if (statsRef.current) { clearInterval(statsRef.current); statsRef.current = null }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
    streamRef.current = null
    if (videoElRef.current) videoElRef.current.srcObject = null
    setCameraStatus('disconnected')
    setLatency(null)
  }, [])

  const cleanupAll = useCallback(() => {
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null }
    cleanupCamera()
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    setPiOnline(false)
    setCar({ connected: false, name: '', battery: null, error: '', scanning: false })
    setStatus('disconnected')
  }, [cleanupCamera])

  // ── Camera (WebRTC via backend relay) ──────────────────────
  const startCamera = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    cleanupCamera()
    setCameraStatus('connecting')

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc

    pc.addTransceiver('video', { direction: 'recvonly' })

    pc.ontrack = (e) => {
      if (e.streams[0]) {
        streamRef.current = e.streams[0]
        if (videoElRef.current) videoElRef.current.srcObject = e.streams[0]
      }
    }

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState
      if (s === 'connected' || s === 'completed') {
        setCameraStatus('connected')
      } else if (s === 'disconnected') {
        cameraRetryRef.current = setTimeout(() => {
          if (pcRef.current?.iceConnectionState === 'disconnected') {
            startCamera()
          }
        }, 2000)
      } else if (s === 'failed') {
        cleanupCamera()
        cameraRetryRef.current = setTimeout(() => startCamera(), 1500)
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: 'camera/candidate', candidate: e.candidate.candidate })
      }
    }

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then((offer) => send({ type: 'camera/offer', sdp: offer.sdp }))

    // Latency polling
    statsRef.current = setInterval(async () => {
      if (!pcRef.current) return
      try {
        const stats = await pcRef.current.getStats()
        for (const r of stats.values()) {
          if (r.type === 'candidate-pair' && r.state === 'succeeded') {
            setLatency(Math.round(r.currentRoundTripTime * 1000 / 2))
            break
          }
        }
      } catch { /* ignore */ }
    }, 2000)
  }, [cleanupCamera, send])

  // ── Backend connection ─────────────────────────────────────
  const connect = useCallback((url) => {
    cleanupAll()
    if (!url) return
    urlRef.current = url
    setStatus('connecting')

    const wsUrl = url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => setStatus('connected')

    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'pi/status') {
        setPiOnline(msg.connected)
        if (!msg.connected) {
          setCar({ connected: false, name: '', battery: null, error: '', scanning: false })
          cleanupCamera()
        }
      } else if (msg.type === 'car/status') {
        setCar({
          connected: !!msg.connected,
          name: msg.name || '',
          battery: msg.battery ?? null,
          error: msg.error || '',
          scanning: !!msg.scanning,
        })
      } else if (msg.type === 'camera/answer') {
        pcRef.current?.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }),
        )
      } else if (msg.type === 'camera/candidate') {
        pcRef.current?.addIceCandidate(
          new RTCIceCandidate({ candidate: msg.candidate, sdpMid: '0' }),
        )
      } else if (msg.type === 'error') {
        setCar((prev) => ({ ...prev, error: msg.message || 'Unknown error' }))
      }
    }

    ws.onclose = () => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      setStatus('disconnected')
      setPiOnline(false)
      cleanupCamera()
      // Auto-reconnect if not explicitly disconnected
      if (urlRef.current) {
        reconnectRef.current = setTimeout(() => connect(urlRef.current), 3000)
      }
    }

    ws.onerror = () => {} // onclose will fire
  }, [cleanupAll, cleanupCamera])

  const disconnect = useCallback(() => {
    urlRef.current = ''
    cleanupAll()
  }, [cleanupAll])

  // ── Car control ────────────────────────────────────────────
  const connectCar = useCallback(() => {
    setCar((prev) => ({ ...prev, scanning: true, error: '' }))
    send({ type: 'car/connect' })
  }, [send])

  const disconnectCar = useCallback(() => {
    send({ type: 'car/disconnect' })
  }, [send])

  // Matches useBle.updateState(key, value) interface
  const updateState = useCallback((key, value) => {
    const map = { w: 'forward', s: 'reverse', a: 'left', d: 'right' }
    const field = map[key] || key
    controlRef.current[field] = value ? 1 : 0
    send({ type: 'control', ...controlRef.current })
  }, [send])

  // ── Cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      urlRef.current = ''    // prevent reconnection
      cleanupAll()
    }
  }, [cleanupAll])

  return {
    // Backend
    status, piOnline, connect, disconnect,
    // Car (mirrors useBle interface)
    car, connectCar, disconnectCar, updateState,
    // Camera (mirrors useWhep interface)
    videoRef, cameraStatus, latency, startCamera, stopCamera: cleanupCamera,
  }
}
