import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id)
})

const PORT = process.env.PORT || 4000
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`))