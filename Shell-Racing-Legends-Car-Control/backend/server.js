import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3000', 10)
const PI_TOKEN = process.env.PI_TOKEN || 'changeme'

// ── Express ────────────────────────────────────────────────────

const app = express()
const server = createServer(app)

app.get('/health', (_req, res) => res.json({ ok: true }))

// Serve frontend build
app.use(express.static(join(__dirname, '../frontend/dist')))
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '../frontend/dist/index.html'))
})

// ── State ──────────────────────────────────────────────────────

let piSocket = null                // single Pi agent WS
const clients = new Map()          // clientId → WebSocket

// ── WebSocket upgrade ──────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  let url
  try {
    url = new URL(req.url, `http://${req.headers.host}`)
  } catch {
    socket.destroy()
    return
  }

  if (url.pathname === '/ws/pi') {
    const token = url.searchParams.get('token')
    if (token !== PI_TOKEN) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => handlePiConnection(ws))
  } else if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => handleClientConnection(ws))
  } else {
    socket.destroy()
  }
})

// ── Pi agent connection ────────────────────────────────────────

const PI_MESSAGE_TYPES = new Set(['car/status', 'camera/answer', 'camera/candidate'])

function handlePiConnection(ws) {
  if (piSocket && piSocket.readyState === WebSocket.OPEN) {
    piSocket.close(4000, 'Replaced by new connection')
  }
  piSocket = ws
  console.log('Pi agent connected')
  broadcast({ type: 'pi/status', connected: true })

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (!msg.type || !PI_MESSAGE_TYPES.has(msg.type)) return

    if (msg.type === 'car/status') {
      broadcast(msg)
    } else {
      // camera/answer or camera/candidate — route to specific client
      const clientId = msg.clientId
      if (!clientId) return
      const client = clients.get(clientId)
      if (client && client.readyState === WebSocket.OPEN) {
        const { clientId: _, ...rest } = msg
        client.send(JSON.stringify(rest))
      }
    }
  })

  ws.on('close', () => {
    if (piSocket === ws) {
      piSocket = null
      console.log('Pi agent disconnected')
      broadcast({ type: 'pi/status', connected: false })
      broadcast({ type: 'car/status', connected: false, name: '', battery: null })
    }
  })

  ws.on('error', (err) => console.error('Pi WS error:', err.message))
}

// ── Web client connection ──────────────────────────────────────

function handleClientConnection(ws) {
  const clientId = randomUUID()
  clients.set(clientId, ws)
  console.log(`Client ${clientId.slice(0, 8)} connected (${clients.size} total)`)

  // Send current state
  ws.send(JSON.stringify({
    type: 'pi/status',
    connected: piSocket != null && piSocket.readyState === WebSocket.OPEN,
  }))

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (!msg.type) return

    if (!piSocket || piSocket.readyState !== WebSocket.OPEN) {
      if (msg.type === 'car/connect' || msg.type === 'car/disconnect') {
        ws.send(JSON.stringify({ type: 'error', message: 'Car not connected — Pi is offline' }))
      } else if (msg.type === 'camera/offer') {
        ws.send(JSON.stringify({ type: 'error', message: 'Camera not connected — Pi is offline' }))
      } else if (msg.type === 'control') {
        ws.send(JSON.stringify({ type: 'error', message: 'Car not connected — Pi is offline' }))
      }
      return
    }

    if (msg.type === 'control') {
      // Sanitise control values to 0|1
      piSocket.send(JSON.stringify({
        type: 'control',
        forward: msg.forward ? 1 : 0,
        reverse: msg.reverse ? 1 : 0,
        left: msg.left ? 1 : 0,
        right: msg.right ? 1 : 0,
        lights: msg.lights ? 1 : 0,
        turbo: msg.turbo ? 1 : 0,
        donut: msg.donut ? 1 : 0,
      }))
    } else if (msg.type === 'car/connect' || msg.type === 'car/disconnect') {
      piSocket.send(JSON.stringify({ type: msg.type }))
    } else if (msg.type === 'camera/offer') {
      if (typeof msg.sdp !== 'string') return
      piSocket.send(JSON.stringify({ type: 'camera/offer', sdp: msg.sdp, clientId }))
    } else if (msg.type === 'camera/candidate') {
      if (typeof msg.candidate !== 'string') return
      piSocket.send(JSON.stringify({ type: 'camera/candidate', candidate: msg.candidate, clientId }))
    }
  })

  ws.on('close', () => {
    clients.delete(clientId)
    console.log(`Client ${clientId.slice(0, 8)} disconnected (${clients.size} total)`)
    // Tell Pi to tear down this client's camera session
    if (piSocket && piSocket.readyState === WebSocket.OPEN) {
      piSocket.send(JSON.stringify({ type: 'camera/stop', clientId }))
    }
  })

  ws.on('error', (err) => console.error(`Client ${clientId.slice(0, 8)} error:`, err.message))
}

// ── Broadcast to all clients ───────────────────────────────────

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const [, ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }
}

// ── Start ──────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`)
  if (PI_TOKEN === 'changeme') {
    console.log('⚠️  Using default PI_TOKEN — set PI_TOKEN env var for production')
  }
})
