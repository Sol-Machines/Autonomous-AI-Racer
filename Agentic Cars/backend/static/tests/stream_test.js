const express = require('express');
const WebSocket = require('ws');
const go2rtc = require('go2rtc');

const app = express();
const wss = new WebSocket.Server({ noServer: true });

// Define the route for accessing the video stream
app.get('/video', (req, res) => {
  // Fetch the video. Can be either a local file or a remote stream. Here is a remote stream example
  const streamUrl = 'http://example.com/video.mjpeg';
  const stream = go2rtc.createStream({
    sources: [
      {
        type: 'http',
        url: streamUrl,
      },
    ],
  });

  // Set up the WebSocket connection
  const ws = new WebSocket('ws://localhost:3000/video');

  // Handle the WebSocket events
  let lastFrameTime = Date.now();
  let frameCount = 0;

  ws.on('open', () => {
    console.log('WebSocket connection opened');
    stream.on('data', (frame) => {
      const currentTime = Date.now();
      const latency = currentTime - lastFrameTime;
      lastFrameTime = currentTime;
      frameCount++;

      console.log(`Received frame ${frameCount} with latency ${latency}ms`);

      ws.send(frame);
    });
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    stream.destroy();
  });

  // Send the video stream to the client
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
  });

  stream.on('data', (frame) => {
    res.write(`--frame\r\n`);
    res.write('Content-Type: image/jpeg\r\n');
    res.write(`Content-Length: ${frame.length}\r\n\r\n`);
    res.write(frame);
  });

  stream.on('error', (error) => {
    console.error('Error fetching video stream:', error);
    res.end();
  });

  // Handle the HTTP request
  res.end();
});

// Handle the WebSocket connection for the video stream
wss.on('connection', (ws) => {
  console.log('WebSocket connection opened');

  // Handle the WebSocket events
  ws.on('message', (message) => {
    console.log('Received message:', message);
    // Handle incoming messages from the client
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Start the server
const server = app.listen(3000, () => {
  console.log('Server started on port 3000');
});