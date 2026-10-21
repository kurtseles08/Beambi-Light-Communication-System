import { io } from 'socket.io-client'
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000'
export const socket = io(BACKEND_URL, {
  autoConnect: false,
  auth: { token: import.meta.env.VITE_COMMAND_TOKEN ?? '' },
})
