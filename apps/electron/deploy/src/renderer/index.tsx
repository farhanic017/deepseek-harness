import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '@deepseek-ai/dsh-web-frontend'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element not found')
}

const root = createRoot(container)

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)