import express from 'express'
import { config } from "dotenv"
import { authenticateUser } from './middleware/authenticateUser.js'
const app = express()
config()

app.use(express.json())
const PORT = process.env.PORT

app.use(authenticateUser)

app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})

