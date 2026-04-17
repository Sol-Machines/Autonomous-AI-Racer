import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * go2rtc WebRTC client hook using WebSocket signaling (same as stream.html).
 * Uses Vite proxy: /api/* → Pi, with ws:true for WebSocket upgrade.
 */
export function useWhep(streamUrl) {
  const [status, setStatus] = useState('disconnected')
  const [latency, setLatency] = useState(null)

  const videoElRef = useRef(null)
  const streamRef = useRef(null)
  const pcRef = useRef(null)
  const wsRef = useRef(null)
  const statsIntervalRef = useRef(null)

  const reconnectRef = useRef(null)
  const connectingRef = useRef(false)

  // Callback ref: when the <video> element mounts, attach any pending stream
  const videoRef = useCallback((el) => {
    videoElRef.current = el
    if (el && streamRef.current) {
      el.srcObject = streamRef.current
    }
  }, [])

  const cleanup = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current)
      statsIntervalRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    streamRef.current = null
    if (videoElRef.current) {
      videoElRef.current.srcObject = null
    }
    setLatency(null)
  }, [])

  const connect = useCallback(async () => {
    if (!streamUrl) return
    if (connectingRef.current) return
    connectingRef.current = true
    cleanup()
    setStatus('connecting')

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = pc

      pc.addTransceiver('video', { direction: 'recvonly' })

      pc.ontrack = (event) => {
        if (event.streams[0]) {
          streamRef.current = event.streams[0]
          if (videoElRef.current) {
            videoElRef.current.srcObject = event.streams[0]
          }
        }
      }

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState
        if (state === 'connected' || state === 'completed') {
          connectingRef.current = false
          setStatus('connected')
        } else if (state === 'disconnected') {
          // Temporary loss — wait for recovery or auto-reconnect
          reconnectRef.current = setTimeout(() => {
            if (pcRef.current?.iceConnectionState === 'disconnected') {
              console.log('Stream lost, reconnecting...')
              connectingRef.current = true
              connect()
            }
          }, 2000)
        } else if (state === 'failed' || state === 'closed') {
          // Hard failure — reconnect immediately
          console.log('ICE failed, reconnecting...')
          cleanup()
          reconnectRef.current = setTimeout(() => {
            connectingRef.current = true
            connect()
          }, 1000)
        }
      }

      // Connect directly to go2rtc WebSocket (not subject to CORS)
      const wsUrl = streamUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/ws?src=camera'
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'webrtc/candidate',
            value: event.candidate.candidate,
          }))
        }
      }

      ws.onopen = async () => {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        ws.send(JSON.stringify({
          type: 'webrtc/offer',
          value: offer.sdp,
        }))
      }

      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'webrtc/answer') {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: msg.value })
          )
        } else if (msg.type === 'webrtc/candidate') {
          await pc.addIceCandidate(
            new RTCIceCandidate({ candidate: msg.value, sdpMid: '0' })
          )
        }
      }

      ws.onerror = (err) => {
        console.error('WebSocket error:', err)
        connectingRef.current = false
        setStatus('error')
        cleanup()
      }

      // Stats polling for latency
      statsIntervalRef.current = setInterval(async () => {
        if (!pcRef.current) return
        try {
          const stats = await pcRef.current.getStats()
          for (const report of stats.values()) {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              setLatency(Math.round(report.currentRoundTripTime * 1000 / 2))
              break
            }
          }
        } catch { /* ignore */ }
      }, 2000)
    } catch (err) {
      console.error('WebRTC connection failed:', err)
      connectingRef.current = false
      setStatus('error')
      cleanup()
    }
  }, [streamUrl, cleanup])

  const disconnect = useCallback(() => {
    connectingRef.current = false
    cleanup()
    setStatus('disconnected')
  }, [cleanup])

  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  return { videoRef, status, latency, connect, disconnect }
}
